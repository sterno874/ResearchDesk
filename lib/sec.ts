import { SEC_HEADERS, getJson } from "./http"
import { readEntry, writeEntry } from "./persist"
import type { Filing } from "./types"

export type Company = {
  ticker: string
  name: string
  cik: string
}

type SecPoint = {
  start?: string
  end?: string
  val?: number
  fy?: number
  fp?: string
  form?: string
  filed?: string
  frame?: string
}

type CompanyFacts = {
  entityName?: string
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, SecPoint[]> }>
    dei?: Record<string, { units?: Record<string, SecPoint[]> }>
  }
}

export type Submissions = {
  sic?: string
  sicDescription?: string
  filings?: {
    recent?: {
      accessionNumber?: string[]
      filingDate?: string[]
      form?: string[]
      primaryDocument?: string[]
      primaryDocDescription?: string[]
      items?: string[]
    }
  }
}

export type Universe = {
  byTicker: Map<string, Company>
  byCik: Map<string, Company>
}

type TickerFile = Record<string, { cik_str: number; ticker: string; title: string }>

let memoryUniverse: { at: number; universe: Universe } | null = null

function padCik(value: string | number): string {
  return String(value).replace(/\D/g, "").padStart(10, "0")
}

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/^\$/, "").replace(/\./g, "-")
}

function preferShareClass(list: Company[]): Company {
  return (
    list.find((company) => company.ticker.endsWith("-B")) ??
    [...list].sort((a, b) => a.ticker.length - b.ticker.length || a.ticker.localeCompare(b.ticker))[0]
  )
}

async function readFresh<T>(name: string, maxAgeMs: number): Promise<T | null> {
  const entry = await readEntry(`cache/${name}`)
  if (!entry || Date.now() - entry.updatedAt > maxAgeMs) return null
  try {
    return JSON.parse(entry.text) as T
  } catch {
    return null
  }
}

async function writeJson(name: string, data: unknown) {
  await writeEntry(`cache/${name}`, JSON.stringify(data))
}

export async function loadUniverse(): Promise<Universe> {
  if (memoryUniverse && Date.now() - memoryUniverse.at < 6 * 60 * 60 * 1000) {
    return memoryUniverse.universe
  }
  const cached = await readFresh<Company[]>("companies.json", 24 * 60 * 60 * 1000)
  const companies =
    cached ??
    (await (async () => {
      const raw = await getJson<TickerFile>("https://www.sec.gov/files/company_tickers.json", SEC_HEADERS, 30000)
      const list = Object.values(raw).map((row) => ({
        ticker: normalizeTicker(row.ticker),
        name: row.title,
        cik: padCik(row.cik_str),
      }))
      await writeJson("companies.json", list)
      return list
    })())

  const byTicker = new Map<string, Company>()
  const byCikLists = new Map<string, Company[]>()
  for (const company of companies) {
    byTicker.set(company.ticker, company)
    const list = byCikLists.get(company.cik) ?? []
    list.push(company)
    byCikLists.set(company.cik, list)
  }
  const byCik = new Map<string, Company>()
  for (const [cik, list] of byCikLists) byCik.set(cik, preferShareClass(list))
  const universe = { byTicker, byCik }
  memoryUniverse = { at: Date.now(), universe }
  return universe
}

export async function loadFacts(cik: string): Promise<CompanyFacts> {
  const safe = padCik(cik)
  const cached = await readFresh<CompanyFacts>(`facts-${safe}.json`, 12 * 60 * 60 * 1000)
  if (cached) return cached
  const facts = await getJson<CompanyFacts>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${safe}.json`,
    SEC_HEADERS,
    45000,
  )
  await writeJson(`facts-${safe}.json`, facts)
  return facts
}

export async function loadSubmissions(cik: string): Promise<Submissions> {
  const safe = padCik(cik)
  return getJson<Submissions>(`https://data.sec.gov/submissions/CIK${safe}.json`, SEC_HEADERS, 25000)
}

function daysBetween(start?: string, end?: string): number | null {
  if (!start || !end) return null
  const span = Date.parse(end) - Date.parse(start)
  if (!Number.isFinite(span)) return null
  return span / 86400000
}

function isAnnualForm(form?: string): boolean {
  if (!form) return false
  return form.startsWith("10-K") || form.startsWith("20-F") || form.startsWith("40-F")
}

function rawPoints(facts: CompanyFacts, name: string): SecPoint[] {
  const node = facts.facts?.["us-gaap"]?.[name] ?? facts.facts?.dei?.[name]
  const units = node?.units
  if (!units) return []
  for (const key of ["USD", "USD/shares", "shares", "pure"]) {
    if (units[key]?.length) return units[key]
  }
  return Object.values(units)[0] ?? []
}

export type AnnualPoint = {
  end: string
  val: number
  fy: number | null
  filed: string
  form: string
}

function better(a: SecPoint, b: SecPoint): SecPoint {
  const filedA = a.filed ?? ""
  const filedB = b.filed ?? ""
  if (filedA !== filedB) return filedA > filedB ? a : b
  if (Boolean(a.frame) !== Boolean(b.frame)) return a.frame ? a : b
  return Math.abs(a.val ?? 0) >= Math.abs(b.val ?? 0) ? a : b
}

function toAnnual(points: SecPoint[]): AnnualPoint[] {
  return [...points]
    .filter((point) => point.end && Number.isFinite(point.val))
    .sort((a, b) => (a.end! < b.end! ? 1 : -1))
    .map((point) => ({
      end: point.end!,
      val: Number(point.val),
      fy: point.fy ?? null,
      filed: point.filed ?? "",
      form: point.form ?? "",
    }))
}

function dedupe(points: SecPoint[]): AnnualPoint[] {
  const chosen = new Map<string, SecPoint>()
  for (const point of points) {
    if (!point.end || !Number.isFinite(Number(point.val))) continue
    const previous = chosen.get(point.end)
    chosen.set(point.end, previous ? better(previous, point) : point)
  }
  return toAnnual([...chosen.values()])
}

function flowAnnual(points: SecPoint[]): AnnualPoint[] {
  const inSpan = points.filter((point) => {
    const span = daysBetween(point.start, point.end)
    return span != null && span >= 330 && span <= 400
  })
  const strict = inSpan.filter((point) => isAnnualForm(point.form))
  return dedupe(strict.length ? strict : inSpan)
}

function instantAnnual(points: SecPoint[]): AnnualPoint[] {
  const instants = points.filter((point) => !point.start || point.start === point.end)
  const strict = instants.filter((point) => isAnnualForm(point.form))
  return dedupe(strict.length ? strict : instants)
}

export function annualSeries(facts: CompanyFacts, names: string[], kind: "flow" | "instant"): AnnualPoint[] {
  let best: AnnualPoint[] = []
  let bestEnd = ""
  for (const name of names) {
    const annual = kind === "flow" ? flowAnnual(rawPoints(facts, name)) : instantAnnual(rawPoints(facts, name))
    const end = annual[0]?.end ?? ""
    if (end > bestEnd) {
      best = annual
      bestEnd = end
    }
  }
  return best
}

export function filingUrl(cik: string, adsh: string): string {
  const cikInt = String(parseInt(padCik(cik), 10))
  const accession = adsh.replace(/-/g, "")
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accession}/${adsh}-index.html`
}

export function readFilings(submissions: Submissions | null, cik: string): {
  filings: Filing[]
  schedule13d: boolean
  insiderForms: number
} {
  const recent = submissions?.filings?.recent
  if (!recent?.form?.length) return { filings: [], schedule13d: false, insiderForms: 0 }
  const filings: Filing[] = []
  let schedule13d = false
  let insiderForms = 0
  const now = Date.now()
  const count = Math.min(recent.form.length, 80)
  for (let i = 0; i < count; i++) {
    const form = recent.form[i] ?? ""
    const date = recent.filingDate?.[i] ?? ""
    const ageDays = date ? (now - Date.parse(date)) / 86400000 : 9999
    if (ageDays <= 180 && form.includes("13D")) schedule13d = true
    if (ageDays <= 120 && form === "4") insiderForms += 1
    const show = /^(10-K|10-Q|8-K|4$|SC 13|SCHEDULE 13|DEF 14A)/.test(form)
    if (!show || filings.length >= 8) continue
    const accession = recent.accessionNumber?.[i]
    const document = recent.primaryDocument?.[i]
    const cikInt = String(parseInt(padCik(cik), 10))
    const url = accession
      ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accession.replace(/-/g, "")}/${document || `${accession}-index.html`}`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padCik(cik)}`
    filings.push({
      form,
      date,
      description: recent.primaryDocDescription?.[i] || form,
      items: recent.items?.[i] || "",
      url,
    })
  }
  return { filings, schedule13d, insiderForms }
}

export type { CompanyFacts }

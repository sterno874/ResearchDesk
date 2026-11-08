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

type FactSet = Record<string, { units?: Record<string, SecPoint[]> }>

type CompanyFacts = {
  entityName?: string
  facts?: {
    "us-gaap"?: FactSet
    "ifrs-full"?: FactSet
    dei?: FactSet
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

export async function loadFacts(cik: string, fresh = false): Promise<CompanyFacts> {
  const safe = padCik(cik)
  if (!fresh) {
    const cached = await readFresh<CompanyFacts>(`facts-${safe}.json`, 12 * 60 * 60 * 1000)
    if (cached) return cached
  }
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

/** IFRS names for a US-GAAP concept. Used only when the US-GAAP tag itself is absent. */
const IFRS_ALIAS: Record<string, string[]> = {
  RevenueFromContractWithCustomerExcludingAssessedTax: ["Revenue"],
  RevenueFromContractWithCustomerIncludingAssessedTax: ["Revenue"],
  Revenues: ["Revenue"],
  SalesRevenueNet: ["Revenue"],
  SalesRevenueGoodsNet: ["Revenue"],
  RegulatedAndUnregulatedOperatingRevenue: ["Revenue"],
  NetIncomeLoss: ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
  OperatingIncomeLoss: ["ProfitLossFromOperatingActivities"],
  GrossProfit: ["GrossProfit"],
  StockholdersEquity: ["EquityAttributableToOwnersOfParent", "Equity"],
  StockholdersEquityAttributableToParent: ["EquityAttributableToOwnersOfParent"],
  StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: ["Equity"],
  Assets: ["Assets"],
  Liabilities: ["Liabilities"],
  AssetsCurrent: ["CurrentAssets"],
  LiabilitiesCurrent: ["CurrentLiabilities"],
  NetCashProvidedByUsedInOperatingActivities: ["CashFlowsFromUsedInOperatingActivities"],
  PaymentsToAcquirePropertyPlantAndEquipment: ["PurchaseOfPropertyPlantAndEquipment"],
  PaymentsToAcquireProductiveAssets: ["PurchaseOfPropertyPlantAndEquipment"],
  PaymentsToAcquireOtherProductiveAssets: ["PurchaseOfPropertyPlantAndEquipment"],
  EarningsPerShareDiluted: ["DilutedEarningsLossPerShare"],
  WeightedAverageNumberOfDilutedSharesOutstanding: ["AdjustedWeightedAverageShares"],
  WeightedAverageNumberOfSharesOutstandingBasic: ["WeightedAverageShares"],
  CashAndCashEquivalentsAtCarryingValue: ["CashAndCashEquivalents"],
  Cash: ["CashAndCashEquivalents"],
  LongTermDebt: ["Borrowings", "ShorttermBorrowings"],
  PaymentsOfDividends: ["DividendsPaid"],
  PaymentsOfDividendsCommonStock: ["DividendsPaid"],
}

function pickUnit(units: Record<string, SecPoint[]>): { unit: string; points: SecPoint[] } | null {
  for (const key of ["USD", "USD/shares", "shares", "pure"]) {
    if (units[key]?.length) return { unit: key, points: units[key] }
  }
  const first = Object.entries(units).find(([, points]) => points.length)
  return first ? { unit: first[0], points: first[1] } : null
}

function readExact(facts: CompanyFacts, name: string): { unit: string; points: SecPoint[] } | null {
  const books = facts.facts
  if (!books) return null
  for (const ns of ["us-gaap", "ifrs-full", "dei"] as const) {
    const picked = pickUnit(books[ns]?.[name]?.units ?? {})
    if (picked) return picked
  }
  return null
}

function resolveTag(facts: CompanyFacts, name: string): { unit: string; points: SecPoint[] } | null {
  const direct = readExact(facts, name)
  if (direct) return direct
  for (const alias of IFRS_ALIAS[name] ?? []) {
    const picked = pickUnit(facts.facts?.["ifrs-full"]?.[alias]?.units ?? {})
    if (picked) return picked
  }
  return null
}

function rawPoints(facts: CompanyFacts, name: string): SecPoint[] {
  return resolveTag(facts, name)?.points ?? []
}

/** Unit of the series this desk would read. Null when the tag is missing or is not a currency. */
export function tagCurrency(facts: CompanyFacts, name: string): string | null {
  const found = resolveTag(facts, name)
  if (!found || !/^[A-Z]{3}$/.test(found.unit)) return null
  return found.unit
}

/** Currency of the revenue series actually used. Null when the tag is missing or is not a currency. */
export function reportingCurrency(facts: CompanyFacts, names: string[]): string | null {
  let bestEnd = ""
  let unit: string | null = null
  for (const name of names) {
    const found = resolveTag(facts, name)
    if (!found || !/^[A-Z]{3}$/.test(found.unit)) continue
    const end = flowAnnual(found.points)[0]?.end ?? ""
    if (end > bestEnd) {
      bestEnd = end
      unit = found.unit
    }
  }
  return unit
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

function sameScale(point: AnnualPoint, chosen: Map<string, AnnualPoint>): boolean {
  let nearest: AnnualPoint | null = null
  let gap = Infinity
  const at = Date.parse(point.end)
  for (const other of chosen.values()) {
    const distance = Math.abs(Date.parse(other.end) - at)
    if (distance < gap) {
      nearest = other
      gap = distance
    }
  }
  if (!nearest?.val || !point.val) return false
  const ratio = point.val / nearest.val
  // A different tag for a missing year has to look like the same series, not a product line or a stub.
  return ratio >= 0.5 && ratio <= 2
}

/** Revenue for the year. A contract-with-customer tag can be one line, while Revenues on the same statement is the total. */
export function revenueSeries(facts: CompanyFacts, names: string[]): AnnualPoint[] {
  const merged = annualSeries(facts, names, "flow")
  const currency = reportingCurrency(facts, names)
  if (!currency) return merged
  const others = names.map((name) => {
    const found = resolveTag(facts, name)
    if (!found || found.unit !== currency) return []
    return flowAnnual(found.points)
  })
  return merged.map((point) => {
    let best = point
    for (const series of others) {
      const other = series.find((item) => item.end === point.end)
      // Twenty percent is past sales tax. A larger total on the same date is the income-statement revenue.
      if (other && other.val > best.val * 1.2) best = { ...point, val: other.val, fy: other.fy ?? point.fy }
    }
    return best
  })
}

export function annualSeries(facts: CompanyFacts, names: string[], kind: "flow" | "instant"): AnnualPoint[] {
  const series = names.map((name) =>
    kind === "flow" ? flowAnnual(rawPoints(facts, name)) : instantAnnual(rawPoints(facts, name)),
  )
  let primary = 0
  let bestEnd = ""
  series.forEach((annual, index) => {
    const end = annual[0]?.end ?? ""
    if (end > bestEnd) {
      bestEnd = end
      primary = index
    }
  })
  const chosen = new Map<string, AnnualPoint>()
  for (const point of series[primary] ?? []) chosen.set(point.end, point)
  series.forEach((annual, index) => {
    if (index === primary) return
    for (const point of annual) {
      if (chosen.has(point.end) || !sameScale(point, chosen)) continue
      chosen.set(point.end, point)
    }
  })
  return [...chosen.values()].sort((a, b) => (a.end < b.end ? 1 : -1))
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

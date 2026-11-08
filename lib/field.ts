import { plainPct, ratio } from "./format"
import { getQuote } from "./market"
import { buildMetrics } from "./metrics"
import { readEntry, writeEntry } from "./persist"
import { loadFacts, type Company, type CompanyFacts, type Universe } from "./sec"
import { median } from "./stats"
import type { FieldBrief, FieldRow, Metrics, SectorId } from "./types"

const DAY = 86400000
const PEERS = 8
const POOL = 9
const MIN_FOR_MEDIAN = 2
/** A filer counts as part of the field only when it is at least this fraction of the SIC's largest revenue. */
const SIZE = 0.05

type RevenueCell = { end: string; val: number; rank: number }

type Snap = {
  ticker: string
  name: string
  cik: string
  grossMargin: number | null
  operatingMargin: number | null
  roe: number | null
  revenueChange3y: number | null
  debtToEquity: number | null
  fcfMargin: number | null
  pe: number | null
  pb: number | null
  revenue: number | null
  marketCap: number | null
  loss: boolean
  priced: boolean
}

type RowKey = "grossMargin" | "operatingMargin" | "roe" | "revenueChange3y" | "debtToEquity" | "fcfMargin" | "pe" | "pb"

const TAGS: { tag: string; rank: number }[] = [
  { tag: "RevenueFromContractWithCustomerExcludingAssessedTax", rank: 0 },
  { tag: "Revenues", rank: 1 },
  { tag: "SalesRevenueNet", rank: 2 },
  { tag: "SalesRevenueGoodsNet", rank: 3 },
]

function padCik(value: string | number): string {
  return String(value).replace(/\D/g, "").padStart(10, "0")
}

function emptyField(sic: string | null, label: string, note: string): FieldBrief {
  return { sic, label, peers: [], rows: [], note }
}

async function readJson<T>(name: string, maxAgeMs: number): Promise<T | null> {
  const entry = await readEntry(`cache/${name}`)
  if (!entry || Date.now() - entry.updatedAt > maxAgeMs) return null
  try {
    return JSON.parse(entry.text) as T
  } catch {
    return null
  }
}

async function fetchText(url: string, accept: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ResearchDesk (personal research desk; contact researchdesk@example.com)",
      Accept: accept,
    },
    signal: AbortSignal.timeout(45000),
    cache: "no-store",
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${response.status} reading ${url}`)
  return response.text()
}

/** Listed-company CIKs the SEC files under this SIC code. */
async function sicCiks(sic: string): Promise<string[]> {
  const cached = await readJson<string[]>(`sic-ciks-${sic}.json`, 7 * DAY)
  if (cached?.length) return cached
  const found: string[] = []
  const seen = new Set<string>()
  for (let start = 0; start < 2000; start += 100) {
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC=${sic}&owner=exclude&count=100&start=${start}&output=atom`
    const xml = await fetchText(url, "application/atom+xml, application/xml, text/xml")
    if (!xml) break
    const page = [...xml.matchAll(/<cik>(\d+)<\/cik>/gi)].map((match) => padCik(match[1]))
    if (!page.length) break
    let added = 0
    for (const cik of page) {
      if (seen.has(cik)) continue
      seen.add(cik)
      found.push(cik)
      added += 1
    }
    if (!added || page.length < 100) break
  }
  if (found.length) await writeEntry(`cache/sic-ciks-${sic}.json`, JSON.stringify(found)).catch(() => undefined)
  return found
}

/** Latest annual USD revenue in the SEC frames, keyed by CIK. Used only to pick the large filers. */
async function revenueIndex(): Promise<Map<string, number>> {
  const cached = await readJson<[string, number][]>("revenue-index.json", DAY)
  if (cached?.length) return new Map(cached)
  const best = new Map<string, RevenueCell>()
  const years = [new Date().getFullYear(), new Date().getFullYear() - 1]
  for (const year of years) {
    for (const { tag, rank } of TAGS) {
      const url = `https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/CY${year}.json`
      const text = await fetchText(url, "application/json")
      if (!text) continue
      const body = JSON.parse(text) as { data?: { cik?: number; end?: string; val?: number }[] }
      for (const row of body.data ?? []) {
        if (row.cik == null || !row.end || row.val == null || !Number.isFinite(row.val) || row.val <= 0) continue
        const cik = padCik(row.cik)
        const prev = best.get(cik)
        if (!prev || row.end > prev.end || (row.end === prev.end && rank < prev.rank)) {
          best.set(cik, { end: row.end, val: row.val, rank })
        }
      }
    }
  }
  const pairs = [...best.entries()].map(([cik, cell]) => [cik, cell.val] as [string, number])
  if (pairs.length) await writeEntry("cache/revenue-index.json", JSON.stringify(pairs)).catch(() => undefined)
  return new Map(pairs)
}

function fcfMargin(metrics: Metrics): number | null {
  if (metrics.fcf == null || metrics.revenue == null || metrics.revenue === 0) return null
  return metrics.fcf / metrics.revenue
}

function snapFrom(company: Company, facts: CompanyFacts, quote: Awaited<ReturnType<typeof getQuote>> | null): Snap {
  const metrics = buildMetrics({ company, facts, submissions: null, quote })
  return {
    ticker: company.ticker,
    name: company.name,
    cik: company.cik,
    grossMargin: metrics.grossMargin,
    operatingMargin: metrics.operatingMargin,
    roe: metrics.roeAvg,
    revenueChange3y: metrics.revenueChange3y,
    debtToEquity: metrics.debtToEquity,
    fcfMargin: fcfMargin(metrics),
    pe: metrics.pe,
    pb: metrics.pb,
    revenue: metrics.revenue,
    marketCap: metrics.marketCap,
    loss: metrics.netIncome != null && metrics.netIncome <= 0,
    priced: metrics.priced,
  }
}

/** Revenue many times the equity value is a unit break, not a large competitor. */
function unitBreak(snap: Snap): boolean {
  if (snap.marketCap == null || snap.revenue == null || snap.marketCap <= 0) return false
  return snap.revenue > snap.marketCap * 40
}

async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(run)))
  }
  return out
}

async function peerSnaps(companies: Company[], fresh: boolean, sic: string): Promise<Snap[]> {
  if (!fresh) {
    const cached = await readJson<Snap[]>(`field-snaps-v11-${sic}.json`, 12 * 60 * 60 * 1000)
    const want = new Set(companies.map((company) => company.cik))
    const picked = cached?.filter((snap) => want.has(snap.cik)) ?? []
    if (want.size > 0 && picked.length === want.size) return picked
  }
  const snaps = (await inBatches(companies, 3, async (company) => {
    try {
      const [facts, quote] = await Promise.all([
        loadFacts(company.cik, fresh),
        getQuote(company.ticker).catch(() => null),
      ])
      return snapFrom(company, facts, quote)
    } catch {
      return null
    }
  })).filter((snap): snap is Snap => snap != null)
  if (snaps.length) await writeEntry(`cache/field-snaps-v11-${sic}.json`, JSON.stringify(snaps)).catch(() => undefined)
  return snaps
}

function rowsFor(sector: SectorId): { key: RowKey; label: string; format: "pct" | "ratio" | "multiple" }[] {
  if (sector === "bank" || sector === "insurer") {
    return [
      { key: "roe", label: "Return on equity", format: "pct" },
      { key: "revenueChange3y", label: "Revenue, three years", format: "pct" },
      { key: "pb", label: "Price / book", format: "multiple" },
    ]
  }
  if (sector === "reit") {
    return [
      { key: "operatingMargin", label: "Operating margin", format: "pct" },
      { key: "revenueChange3y", label: "Revenue, three years", format: "pct" },
      { key: "debtToEquity", label: "Debt / equity", format: "ratio" },
      { key: "pb", label: "Price / book", format: "multiple" },
    ]
  }
  return [
    { key: "grossMargin", label: "Gross margin", format: "pct" },
    { key: "operatingMargin", label: "Operating margin", format: "pct" },
    { key: "roe", label: "Return on equity", format: "pct" },
    { key: "revenueChange3y", label: "Revenue, three years", format: "pct" },
    { key: "debtToEquity", label: "Debt / equity", format: "ratio" },
    { key: "fcfMargin", label: "Free cash flow / revenue", format: "pct" },
    { key: "pe", label: "Price / earnings", format: "multiple" },
    { key: "pb", label: "Price / book", format: "multiple" },
  ]
}

function companyNumber(metrics: Metrics, key: RowKey): number | null {
  if (key === "fcfMargin") return fcfMargin(metrics)
  if (key === "roe") return metrics.roeAvg
  return metrics[key]
}

function formatValue(key: RowKey, format: "pct" | "ratio" | "multiple", value: number | null, loss = false, priced = false): string {
  if (key === "pe" && loss && priced) return "Losses"
  if (value == null) return "—"
  if (format === "pct") return plainPct(value, 1)
  if (format === "ratio") return ratio(value)
  return `${ratio(value, 1)}×`
}

function sits(company: number | null, field: number | null, count: number, higher: boolean): string {
  if (count < MIN_FOR_MEDIAN || company == null || field == null) return "—"
  const diff = Math.abs(company - field)
  const relative = diff / Math.max(Math.abs(field), 1e-9)
  if (relative < 0.1 || diff < 0.01) return "In line"
  if (higher) return company > field ? "Higher" : "Lower"
  return company > field ? "Above" : "Below"
}

export async function loadField(input: {
  company: Company
  metrics: Metrics
  sector: SectorId
  sic: string | null
  sicDescription: string | null
  universe: Universe
  fresh: boolean
}): Promise<FieldBrief> {
  const sic = input.sic && /^\d{3,4}$/.test(input.sic) ? input.sic : null
  const described = input.sicDescription ? input.sicDescription.toLowerCase() : null
  const label = sic ? `SIC ${sic}${described ? `, ${described}` : ""}` : "No industry code"
  if (!sic) {
    return emptyField(null, label, "The filing has no SIC code, so there is no field of filers to compare.")
  }
  try {
    const [ciks, revenues] = await Promise.all([sicCiks(sic), revenueIndex()])
    const ranked = ciks
      .map((cik) => ({ cik, revenue: revenues.get(cik) ?? null, company: input.universe.byCik.get(cik) ?? null }))
      .filter((row): row is { cik: string; revenue: number; company: Company } => row.revenue != null && row.revenue > 0 && row.company != null)
      .sort((a, b) => b.revenue - a.revenue)
    const floor = (ranked[0]?.revenue ?? 0) * SIZE
    const pool = ranked.filter((row) => row.revenue >= floor).slice(0, POOL).map((row) => row.company)
    const snaps = await peerSnaps(pool, input.fresh, sic)
    const peers = snaps
      .filter((snap) => snap.cik !== padCik(input.company.cik) && !unitBreak(snap))
      .slice(0, PEERS)
    if (peers.length < MIN_FOR_MEDIAN) {
      return emptyField(
        sic,
        label,
        peers.length
          ? `Only ${peers.length} other large USD ${peers.length === 1 ? "filer was" : "filers were"} readable in ${label}. A field median needs two, so nothing is compared.`
          : `No other large USD filer in ${label} had a readable annual revenue in the SEC frame.`,
      )
    }
    const rows: FieldRow[] = rowsFor(input.sector).map((row) => {
      const values = peers
        .map((peer) => peer[row.key])
        .filter((value): value is number => value != null && Number.isFinite(value))
      const mid = values.length >= MIN_FOR_MEDIAN ? median(values) : null
      const own = companyNumber(input.metrics, row.key)
      const higher = row.key === "debtToEquity" || row.key === "pe" || row.key === "pb"
      return {
        label: row.label,
        company: formatValue(row.key, row.format, own, input.metrics.netIncome != null && input.metrics.netIncome <= 0, input.metrics.priced),
        median: formatValue(row.key, row.format, mid),
        sits: sits(own, mid, values.length, higher),
      }
    })
    const names = peers.map((peer) => peer.ticker).join(", ")
    return {
      sic,
      label,
      peers: peers.map((peer) => ({ ticker: peer.ticker, name: peer.name })),
      rows,
      note: `The field is the other large USD filers in ${label}: ${names}. Large means at least 5% of the biggest revenue in that SIC code, using the latest annual figure in the SEC frame. This company is left out of the median. A row stays blank when fewer than two of them report that figure. Above means the figure is higher. Debt and the price multiples say Higher or Lower, because a higher one is not a healthier business. Return on equity is the average of recent years, and a year whose earnings were larger than the book is left out.`,
    }
  } catch {
    return emptyField(sic, label, "The industry list didn't load, so there is no field to compare.")
  }
}

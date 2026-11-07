import { SEC_HEADERS, getJson } from "./http"
import { filingUrl, loadUniverse, normalizeTicker, type Company, type Universe } from "./sec"
import type { Draft } from "./store"
import type { CollectSummary } from "./types"

const STOP = new Set([
  "A", "I", "IT", "ALL", "FOR", "CEO", "CFO", "EPS", "SEC", "IPO", "USA", "GDP", "ROE", "FCF",
  "PE", "PB", "AI", "ETF", "IMO", "DD", "USD", "YOY", "QOQ", "OTC", "ATH", "OP", "EDIT", "IRS",
  "NYSE", "NASDAQ", "THE", "AND", "NEW", "BUY", "HOLD", "SELL", "CASH", "DEBT", "BEAT", "MISS",
  "CALL", "FORM", "ITEM", "NOW", "BIG", "LOW", "HIGH", "GOOD", "BAD", "JUST", "HAVE", "THIS",
  "THAT", "WITH", "FROM", "YOUR", "ARE", "WAS", "HAS", "NOT", "BUT", "ANY", "CAN", "OUT", "GET",
  "WHY", "HOW", "WHO", "OUR", "YOU", "THEY", "THEM", "WILL", "WHAT", "WHEN", "INTO", "OVER",
  "UNDER", "AFTER", "BEFORE", "ABOUT", "YOLO", "TLDR", "IMO", "FYI", "PSA", "ATH", "ATL", "EV",
  "DCF", "NAV", "IPO", "SPAC", "ETF", "QQQ", "SPY", "DIA", "IWM", "API",
])

// Ordinary words that are also short tickers. A cashtag or "(TICKER)" still counts.
const BARE = new Set([
  "AN", "AS", "AT", "BE", "BY", "DO", "GO", "HE", "IF", "IN", "IS", "IT", "MY", "NO", "OF", "OK",
  "ON", "OR", "PM", "SO", "TO", "UP", "US", "VS", "WE", "AM", "CC", "MF", "SAY", "ALL", "NOW",
  "BIG", "LOW", "ONE", "TWO", "MAY", "DID", "HAD", "GOT", "LET", "SEE", "WAY", "DAY", "LOT", "REAL",
  "NEXT", "BEST", "MUCH", "VERY", "LIKE", "ALSO", "THAN", "THEN", "SOME", "SUCH", "ONLY", "EVEN",
  "BACK", "MAKE", "MADE", "MOST", "MORE", "MANY", "SAME", "EACH", "BOTH", "FEW", "HIS", "HER", "ITS",
  "TOO", "CAN", "OUT", "GET", "WHY", "HOW", "WHO", "OUR", "YOU", "NEW", "FOR", "THE", "AND",
])

type EftsHit = {
  ciks?: string[]
  display_names?: string[]
  file_date?: string
  form?: string
  adsh?: string
  items?: string[]
}

type RedditPost = {
  title?: string
  selftext?: string
  permalink?: string
  url?: string
  created_utc?: number
  subreddit?: string
}

function daysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

async function efts(params: Record<string, string>): Promise<EftsHit[]> {
  const query = new URLSearchParams({ from: "0", size: "40", ...params })
  const data = await getJson<{ hits?: { hits?: { _source?: EftsHit }[] } }>(
    `https://efts.sec.gov/LATEST/search-index?${query}`,
    SEC_HEADERS,
    30000,
  )
  return (data.hits?.hits ?? []).map((hit) => hit._source).filter((hit): hit is EftsHit => Boolean(hit))
}

function tickerInName(name: string): string | null {
  const matches = [...name.matchAll(/\(([A-Z0-9][A-Z0-9.\-]{0,5})\)/g)].map((match) => match[1])
  const ticker = matches.find((value) => value !== "CIK")
  return ticker ? normalizeTicker(ticker) : null
}

function investable(company: Company): boolean {
  const name = company.name
  if (/\bETFs?\b|\bETNs?\b/i.test(name)) return false
  if (/Acquisition Corp|Blank Check/i.test(name)) return false
  if (/\b(Warrant|Rights)\b/i.test(name)) return false
  if (/^(iShares|SPDR|ProShares|Direxion|VanEck)\b/i.test(name)) return false
  return true
}

function issuer(hit: EftsHit, universe: Universe): Company | null {
  for (const name of hit.display_names ?? []) {
    const ticker = tickerInName(name)
    if (!ticker) continue
    const company = universe.byTicker.get(ticker)
    if (company && investable(company)) return company
  }
  for (const cik of hit.ciks ?? []) {
    const company = universe.byCik.get(cik.padStart(10, "0"))
    if (company && investable(company)) return company
  }
  return null
}

function extractTickers(text: string, universe: Universe, loose = false): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    const ticker = normalizeTicker(raw)
    if (seen.has(ticker) || STOP.has(ticker) || ticker.length < 2) return
    if (!universe.byTicker.has(ticker)) return
    seen.add(ticker)
    found.push(ticker)
  }
  for (const match of text.matchAll(/\$([A-Za-z]{1,5})\b/g)) add(match[1])
  for (const match of text.matchAll(/\((?:NASDAQ|NYSE|NYSEAMERICAN|AMEX):\s*([A-Za-z]{1,5})\)/gi)) add(match[1])
  for (const match of text.matchAll(/\(([A-Za-z]{1,5}(?:\s*,\s*[A-Za-z]{1,5})*)\)/g)) {
    for (const part of match[1].split(/\s*,\s*/)) add(part)
  }
  if (!found.length && loose) {
    for (const match of text.matchAll(/\b([A-Z]{3,5})\b/g)) {
      if (BARE.has(match[1])) continue
      add(match[1])
    }
  }
  return found.slice(0, 2)
}

async function from13d(universe: Universe): Promise<Draft[]> {
  const hits = await efts({
    forms: "SCHEDULE 13D",
    dateRange: "custom",
    startdt: daysAgo(28),
    enddt: daysAgo(0),
  })
  const drafts: Draft[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const company = issuer(hit, universe)
    if (!company || seen.has(company.ticker) || !hit.adsh) continue
    seen.add(company.ticker)
    drafts.push({
      ticker: company.ticker,
      name: company.name,
      rank: 10,
      source: {
        kind: "sec",
        label: hit.form || "Schedule 13D",
        title: `${hit.form || "Schedule 13D"} filed for ${company.name}`,
        url: filingUrl(company.cik, hit.adsh),
        at: hit.file_date || new Date().toISOString().slice(0, 10),
      },
    })
    if (drafts.length >= 8) break
  }
  return drafts
}

async function fromEarnings(universe: Universe): Promise<Draft[]> {
  const hits = await efts({
    forms: "8-K",
    items: "2.02",
    dateRange: "custom",
    startdt: daysAgo(8),
    enddt: daysAgo(0),
  })
  const drafts: Draft[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const company = issuer(hit, universe)
    if (!company || seen.has(company.ticker) || !hit.adsh) continue
    seen.add(company.ticker)
    drafts.push({
      ticker: company.ticker,
      name: company.name,
      rank: 8,
      source: {
        kind: "earnings",
        label: "Earnings 8-K",
        title: `Results of operations filed for ${company.name}`,
        url: filingUrl(company.cik, hit.adsh),
        at: hit.file_date || new Date().toISOString().slice(0, 10),
      },
    })
    if (drafts.length >= 8) break
  }
  return drafts
}

async function fromForm4(universe: Universe): Promise<Draft[]> {
  const hits = await efts({
    forms: "4",
    dateRange: "custom",
    startdt: daysAgo(5),
    enddt: daysAgo(0),
    size: "60",
  })
  const grouped = new Map<string, { company: Company; count: number; at: string; url: string }>()
  for (const hit of hits) {
    const company = issuer(hit, universe)
    if (!company || !hit.adsh) continue
    const current = grouped.get(company.ticker) ?? {
      company,
      count: 0,
      at: hit.file_date || "",
      url: filingUrl(company.cik, hit.adsh),
    }
    current.count += 1
    if ((hit.file_date || "") >= current.at) {
      current.at = hit.file_date || current.at
      current.url = filingUrl(company.cik, hit.adsh)
    }
    grouped.set(company.ticker, current)
  }
  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || b.at.localeCompare(a.at))
    .slice(0, 8)
    .map((row) => ({
      ticker: row.company.ticker,
      name: row.company.name,
      rank: 4 + Math.min(row.count, 4),
      source: {
        kind: "sec",
        label: row.count > 1 ? `Form 4 ×${row.count}` : "Form 4",
        title:
          row.count > 1
            ? `${row.count} insider Form 4s at ${row.company.name}. The index does not say buy or sell.`
            : `Insider Form 4 at ${row.company.name}. The index does not say buy or sell.`,
        url: row.url,
        at: row.at || new Date().toISOString().slice(0, 10),
      },
    }))
}

async function from10q(universe: Universe): Promise<Draft[]> {
  const hits = await efts({
    forms: "10-Q",
    dateRange: "custom",
    startdt: daysAgo(10),
    enddt: daysAgo(0),
  })
  const drafts: Draft[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const company = issuer(hit, universe)
    if (!company || seen.has(company.ticker) || !hit.adsh) continue
    seen.add(company.ticker)
    drafts.push({
      ticker: company.ticker,
      name: company.name,
      rank: 3,
      source: {
        kind: "sec",
        label: "10-Q",
        title: `New quarterly report for ${company.name}`,
        url: filingUrl(company.cik, hit.adsh),
        at: hit.file_date || new Date().toISOString().slice(0, 10),
      },
    })
    if (drafts.length >= 5) break
  }
  return drafts
}

async function fromReddit(universe: Universe, subreddit: string): Promise<Draft[]> {
  const data = await getJson<{ data?: RedditPost[] }>(
    `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${encodeURIComponent(subreddit)}&limit=25&sort=desc`,
    { "User-Agent": "ResearchDesk", Accept: "application/json" },
    25000,
  )
  const now = Date.now() / 1000
  const posts = (data.data ?? [])
    .filter((post) => post.created_utc && post.title)
    .sort((a, b) => (b.created_utc ?? 0) - (a.created_utc ?? 0))
  const recent = posts.filter((post) => (post.created_utc ?? 0) > now - 120 * 86400)
  const used = (recent.length ? recent : posts).slice(0, 12)
  const drafts: Draft[] = []
  for (const post of used) {
    const title = post.title ?? ""
    const tickers = extractTickers(title, universe, true)
    for (const ticker of extractTickers((post.selftext ?? "").slice(0, 1200), universe)) {
      if (tickers.length >= 2 || tickers.includes(ticker)) continue
      tickers.push(ticker)
    }
    const at = new Date((post.created_utc ?? now) * 1000).toISOString()
    const url = post.permalink ? `https://www.reddit.com${post.permalink}` : post.url || "https://www.reddit.com"
    for (const ticker of tickers) {
      const company = universe.byTicker.get(ticker)
      if (!company || !investable(company)) continue
      drafts.push({
        ticker: company.ticker,
        name: company.name,
        rank: 7,
        source: {
          kind: "forum",
          label: `r/${post.subreddit || subreddit}`,
          title: (post.title || ticker).slice(0, 180),
          url,
          at,
        },
      })
    }
  }
  return drafts.slice(0, 6)
}

const FORUMS = ["ValueInvesting", "SecurityAnalysis", "Undervalued", "DeepValueInvesting", "Burryology"]

type FeedItem = { title: string; url: string; at: string; text: string }

function decodeXml(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits)
      return code > 0 && code < 65536 ? String.fromCharCode(code) : " "
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function feedItems(xml: string): FeedItem[] {
  const items: FeedItem[] = []
  for (const chunk of xml.split(/<(?:item|entry)\b/i).slice(1)) {
    const title = decodeXml(chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 180)
    const url = (
      chunk.match(/<link[^>]*href=['"]([^'"]+)['"]/i)?.[1]
      || chunk.match(/<link>([^<]+)<\/link>/i)?.[1]
      || ""
    ).trim()
    const when = chunk.match(/<(?:pubDate|published|updated)>([^<]+)</i)?.[1] ?? ""
    const body = decodeXml(chunk.match(/<(?:description|content)[^>]*>([\s\S]*?)<\/(?:description|content)>/i)?.[1] ?? "").slice(0, 1600)
    const at = new Date(when)
    if (!title || !url) continue
    items.push({
      title,
      url,
      at: Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(),
      text: `${title}\n${body}`,
    })
  }
  return items
}

async function getText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ResearchDesk (personal research desk; contact researchdesk@example.com)",
      Accept: "application/rss+xml, application/atom+xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(25000),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`)
  return response.text()
}

async function fromFeed(
  universe: Universe,
  source: { label: string; url: string; rank: number; maxAgeDays: number; limit: number },
): Promise<Draft[]> {
  const items = feedItems(await getText(source.url))
  const cutoff = Date.now() - source.maxAgeDays * 86400000
  const drafts: Draft[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (Date.parse(item.at) < cutoff) continue
    const tickers = extractTickers(item.text, universe)
    for (const ticker of tickers) {
      if (seen.has(ticker)) continue
      const company = universe.byTicker.get(ticker)
      if (!company || !investable(company)) continue
      seen.add(ticker)
      drafts.push({
        ticker: company.ticker,
        name: company.name,
        rank: source.rank,
        source: {
          kind: "news",
          label: source.label,
          title: item.title,
          url: item.url,
          at: item.at,
        },
      })
      if (drafts.length >= source.limit) return drafts
    }
  }
  return drafts
}

async function settle(label: string, task: Promise<Draft[]>): Promise<{ drafts: Draft[]; warning?: string }> {
  try {
    const drafts = await task
    return { drafts }
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed"
    return { drafts: [], warning: `${label} didn't load (${message}).` }
  }
}

export async function collectIdeas(): Promise<{ drafts: Draft[]; summary: Omit<CollectSummary, "added" | "merged"> }> {
  const universe = await loadUniverse()
  const batches = await Promise.all([
    settle("Schedule 13D", from13d(universe)),
    settle("Earnings releases", fromEarnings(universe)),
    settle("Form 4", fromForm4(universe)),
    settle("10-Q", from10q(universe)),
    ...FORUMS.map((subreddit) => settle(`r/${subreddit}`, fromReddit(universe, subreddit))),
    settle("News search", fromFeed(universe, {
      label: "News",
      url: "https://news.google.com/rss/search?q=%22undervalued%22+OR+%22net-net%22+OR+%22special+situation%22+OR+activist+stock&hl=en-US&gl=US&ceid=US:en",
      rank: 5,
      maxAgeDays: 14,
      limit: 8,
    })),
    settle("Clark Street Value", fromFeed(universe, {
      label: "Clark Street Value",
      url: "https://clarkstreetvalue.blogspot.com/feeds/posts/default?max-results=8",
      rank: 8,
      maxAgeDays: 200,
      limit: 6,
    })),
  ])
  const drafts = batches.flatMap((batch) => batch.drafts)
  const warnings = batches.flatMap((batch) => (batch.warning ? [batch.warning] : []))
  const count = (kind: Draft["source"]["kind"], labelMatch?: string) =>
    new Set(
      drafts.filter((draft) => draft.source.kind === kind && (!labelMatch || draft.source.label.includes(labelMatch))).map((draft) => draft.ticker),
    ).size
  return {
    drafts,
    summary: {
      counts: [
        { label: "Schedule 13D", count: count("sec", "13D") },
        { label: "Earnings releases", count: count("earnings") },
        { label: "Form 4", count: drafts.filter((draft) => draft.source.label.startsWith("Form 4")).length },
        { label: "10-Q", count: count("sec", "10-Q") },
        { label: "Forums", count: count("forum") },
        { label: "News", count: count("news") },
      ].filter((row) => row.count > 0),
      warnings,
    },
  }
}

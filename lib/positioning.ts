import { getJson } from "./http"
import type { Positioning } from "./types"

const HEADERS = { "User-Agent": "Mozilla/5.0", Accept: "application/json" }

type ShortRow = {
  settlementDate?: string
  interest?: string
  daysToCover?: number | string
}

type ShortPayload = {
  data?: { shortInterestTable?: { rows?: ShortRow[] } } | null
}

type ChainRow = {
  strike?: string | null
  c_Volume?: string | null
  p_Volume?: string | null
  c_Openinterest?: string | null
  p_Openinterest?: string | null
}

type ChainPayload = {
  data?: {
    totalRecord?: number
    table?: { rows?: ChainRow[] }
  } | null
}

function symbols(ticker: string): string[] {
  const raw = ticker.toUpperCase()
  const dotted = raw.replace(/-/g, ".")
  return dotted === raw ? [raw] : [raw, dotted]
}

function parseCount(value: string | number | null | undefined): number | null {
  if (value == null || value === "" || value === "--") return null
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

function settlementIso(value: string | undefined): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value ?? "")
  if (!match) return null
  const month = match[1].padStart(2, "0")
  const day = match[2].padStart(2, "0")
  return `${match[3]}-${month}-${day}`
}

async function shortReport(ticker: string): Promise<{ interest: number; prior: number | null; days: number | null; settlement: string | null } | null> {
  for (const symbol of symbols(ticker)) {
    try {
      const payload = await getJson<ShortPayload>(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/short-interest?assetClass=stocks`,
        HEADERS,
        20000,
      )
      const rows = payload.data?.shortInterestTable?.rows ?? []
      const latest = rows[0]
      const interest = parseCount(latest?.interest)
      if (interest == null || interest < 0) continue
      const prior = parseCount(rows[1]?.interest)
      const days = parseCount(latest?.daysToCover)
      return { interest, prior, days, settlement: settlementIso(latest?.settlementDate) }
    } catch {
      continue
    }
  }
  return null
}

async function optionRatio(ticker: string): Promise<{ volume: number | null; openInterest: number | null } | null> {
  for (const symbol of symbols(ticker)) {
    try {
      const payload = await getJson<ChainPayload>(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/option-chain?assetclass=stocks&limit=2500`,
        HEADERS,
        20000,
      )
      const reported = payload.data?.totalRecord ?? 0
      const rows = (payload.data?.table?.rows ?? []).filter((row) => row.strike)
      if (!rows.length || reported <= 0 || rows.length < reported * 0.9) continue
      let callVolume = 0
      let putVolume = 0
      let callInterest = 0
      let putInterest = 0
      let interestSeen = false
      for (const row of rows) {
        callVolume += parseCount(row.c_Volume) ?? 0
        putVolume += parseCount(row.p_Volume) ?? 0
        const calls = parseCount(row.c_Openinterest)
        const puts = parseCount(row.p_Openinterest)
        if (calls != null || puts != null) interestSeen = true
        callInterest += calls ?? 0
        putInterest += puts ?? 0
      }
      return {
        volume: callVolume > 0 ? putVolume / callVolume : null,
        openInterest: interestSeen && callInterest > 0 ? putInterest / callInterest : null,
      }
    } catch {
      continue
    }
  }
  return null
}

export async function loadPositioning(ticker: string): Promise<Positioning> {
  const [shortResult, chainResult] = await Promise.allSettled([shortReport(ticker), optionRatio(ticker)])
  const short = shortResult.status === "fulfilled" ? shortResult.value : null
  const chain = chainResult.status === "fulfilled" ? chainResult.value : null
  const shortChange = short?.prior != null && short.prior > 0 ? short.interest / short.prior - 1 : null
  const note = "Short interest is Nasdaq's latest settlement. Days to cover uses that report's average daily volume. Short / shares uses the share count on this report, not the public float. Put/call is puts divided by calls on the composite option chain. These readings do not change the stars."
  if (!short && !chain) {
    return {
      shortInterest: null,
      shortPrior: null,
      shortChange: null,
      daysToCover: null,
      shortPercent: null,
      settlement: null,
      putCallVolume: null,
      putCallOpenInterest: null,
      note: "Nasdaq did not return short interest or an option chain for this ticker.",
    }
  }
  return {
    shortInterest: short?.interest ?? null,
    shortPrior: short?.prior ?? null,
    shortChange,
    daysToCover: short?.days ?? null,
    shortPercent: null,
    settlement: short?.settlement ?? null,
    putCallVolume: chain?.volume ?? null,
    putCallOpenInterest: chain?.openInterest ?? null,
    note,
  }
}

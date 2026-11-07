import { getJson } from "./http"
import type { Quote } from "./types"

type YahooChart = {
  chart?: {
    result?: {
      meta?: {
        regularMarketPrice?: number
        chartPreviousClose?: number
        previousClose?: number
        currency?: string
        regularMarketTime?: number
        regularMarketChangePercent?: number
      }
      timestamp?: number[]
      indicators?: { quote?: { close?: (number | null)[] }[] }
    }[]
    error?: { description?: string }
  }
}

export async function getQuote(ticker: string): Promise<Quote> {
  const symbol = encodeURIComponent(ticker)
  const data = await getJson<YahooChart>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1wk&range=2y`,
    { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    20000,
  )
  const result = data.chart?.result?.[0]
  const price = result?.meta?.regularMarketPrice
  if (!result || price == null) {
    throw new Error(data.chart?.error?.description || "No market price")
  }
  const timestamps = result.timestamp ?? []
  const closes = result.indicators?.quote?.[0]?.close ?? []
  const history: { date: string; close: number }[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i]
    if (close == null || !Number.isFinite(close)) continue
    history.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      close,
    })
  }
  const step = Math.max(1, Math.ceil(history.length / 36))
  const sampled = history.filter((point, index) => index % step === 0 || index === history.length - 1)
  const asOf = result.meta?.regularMarketTime
    ? new Date(result.meta.regularMarketTime * 1000).toISOString()
    : null
  return {
    price,
    previousClose: result.meta?.previousClose ?? null,
    changePercent:
      result.meta?.regularMarketChangePercent == null
        ? null
        : result.meta.regularMarketChangePercent / 100,
    currency: result.meta?.currency ?? "USD",
    asOf,
    history: sampled,
  }
}

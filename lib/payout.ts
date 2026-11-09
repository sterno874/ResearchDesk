import { money, plainPct, price } from "./format"
import { annualSeries, tagCurrency, type CompanyFacts } from "./sec"
import { skipsMultiple } from "./sector"
import type { Metrics, Payout, SectorId } from "./types"

const STATEMENT_MS = 45 * 86400000

function onStatement(
  facts: CompanyFacts,
  names: string[],
  kind: "flow" | "instant",
  fiscalEnd: string | null,
  currency: string | null,
): number | null {
  if (!fiscalEnd) return null
  const at = Date.parse(fiscalEnd)
  if (!Number.isFinite(at)) return null
  let best: number | null = null
  for (const name of names) {
    const unit = tagCurrency(facts, name)
    if (!unit || unit !== (currency || "USD")) continue
    const hit = annualSeries(facts, [name], kind).find((point) => Math.abs(Date.parse(point.end) - at) <= STATEMENT_MS)
    if (!hit || !Number.isFinite(hit.val)) continue
    const value = Math.abs(hit.val)
    if (best == null || value > best) best = value
  }
  return best
}

function pricePaid(facts: CompanyFacts, buybacks: number, fiscalEnd: string | null): number | null {
  if (!(buybacks > 0) || !fiscalEnd) return null
  const series = annualSeries(facts, ["CommonStockSharesOutstanding", "CommonStockSharesIssuedAndOutstanding"], "instant")
    .filter((point) => point.val > 0)
  const newer = series[0]
  const older = series[1]
  if (!newer || !older) return null
  const gap = Date.parse(newer.end) - Date.parse(older.end)
  if (!Number.isFinite(gap) || gap < 300 * 86400000 || gap > 450 * 86400000) return null
  if (Math.abs(Date.parse(newer.end) - Date.parse(fiscalEnd)) > STATEMENT_MS) return null
  const ratio = newer.val / older.val
  if (!(ratio > 0.8 && ratio < 1)) return null
  const retired = older.val - newer.val
  if (retired / older.val < 0.005 || retired / older.val > 0.2) return null
  return buybacks / retired
}

/** Dividends and repurchases on the same statement as the annual figures. Not an input to the stars. */
export function readPayout(facts: CompanyFacts, metrics: Metrics, sector: SectorId, deep: number | null): Payout | null {
  const currency = metrics.statementCurrency ?? metrics.currency
  const dividends = onStatement(facts, ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"], "flow", metrics.fiscalEnd, currency)
  const buybacks = onStatement(facts, ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity"], "flow", metrics.fiscalEnd, currency)
  if (!(dividends != null && dividends > 0) && !(buybacks != null && buybacks > 0)) return null
  const earnings = metrics.netIncome != null && metrics.netIncome > 0 ? metrics.netIncome : null
  const cash = !skipsMultiple(sector) && metrics.fcf != null && metrics.fcf > 0 ? metrics.fcf : null
  const earningsPayout = dividends != null && dividends > 0 && earnings != null ? dividends / earnings : null
  const cashPayout = dividends != null && dividends > 0 && cash != null ? dividends / cash : null
  const paid = buybacks != null ? pricePaid(facts, buybacks, metrics.fiscalEnd) : null
  const sameCurrency = !metrics.statementCurrency || metrics.statementCurrency === metrics.currency
  const floor = deep != null && deep > 0 ? deep : null
  const comparable = sameCurrency && paid != null && floor != null ? paid : null

  const lines: string[] = []
  if (dividends != null && dividends > 0) {
    if (earningsPayout != null) {
      lines.push(`Dividends paid were ${money(dividends, currency)}. Earnings were ${money(earnings, currency)}, so the payout is ${plainPct(earningsPayout, 0)}.`)
    } else {
      lines.push(`Dividends paid were ${money(dividends, currency)} in a year without positive earnings.`)
    }
    if (cashPayout != null) {
      lines.push(`Free cash flow was ${money(cash, currency)}, so the dividend is ${plainPct(cashPayout, 0)} of that cash.`)
    } else if (skipsMultiple(sector)) {
      lines.push("Free cash flow is not the coverage test on this statement.")
    }
  }
  if (buybacks != null && buybacks > 0) {
    if (comparable != null) {
      const against = floor != null && comparable > floor * 1.05
        ? "above the deep-value price"
        : floor != null && comparable < floor * 0.95
          ? "below the deep-value price"
          : "about the deep-value price"
      lines.push(`Stock repurchased was ${money(buybacks, currency)}. The share count fell, and that cash works out to about ${price(comparable, currency)} a share, ${against} of ${price(floor, metrics.currency)}.`)
    } else {
      lines.push(`Stock repurchased was ${money(buybacks, currency)}. The share count does not show a clean retirement of shares, so a price paid is not set.`)
    }
  }

  const bits: string[] = []
  if (earningsPayout != null) bits.push(`Dividend ${plainPct(earningsPayout, 0)} of earnings`)
  else if (cashPayout != null) bits.push(`Dividend ${plainPct(cashPayout, 0)} of free cash flow`)
  else if (dividends != null && dividends > 0) bits.push("Dividend without earnings")
  if (comparable != null) bits.push(`Buybacks at ${price(paid, currency)}`)
  else if (buybacks != null && buybacks > 0) bits.push(`Buybacks ${money(buybacks, currency)}`)

  return {
    line: bits.join(" · "),
    note: lines.join(" "),
  }
}

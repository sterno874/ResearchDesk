import { annualSeries, readFilings, reportingCurrency, revenueSeries, type Company, type CompanyFacts, type Submissions } from "./sec"
import { cv, median } from "./stats"
import type { Metrics, Quote, YearPoint } from "./types"
import type { AnnualPoint } from "./sec"

function byEnd(points: AnnualPoint[]): Map<string, number> {
  return new Map(points.map((point) => [point.end, point.val]))
}

function change(latestValue: number | null, earlier: number | null): number | null {
  if (latestValue == null || earlier == null || earlier === 0) return null
  return latestValue / earlier - 1
}

function yearsBetween(later: string, earlier: string): number | null {
  const span = Date.parse(later) - Date.parse(earlier)
  if (!Number.isFinite(span) || span <= 0) return null
  return span / (365.25 * 86400000)
}

export function revenueAbout(series: YearPoint[], years: number): number | null {
  const latest = series[0]
  if (!latest?.end) return null
  const target = Date.parse(latest.end) - years * 365.25 * 86400000
  let best: YearPoint | null = null
  let bestGap = Infinity
  for (const year of series.slice(1)) {
    if (year.revenue == null) continue
    const gap = Math.abs(Date.parse(year.end) - target)
    if (gap < bestGap) {
      best = year
      bestGap = gap
    }
  }
  // A fiscal year can drift a couple of weeks. A missing year is a different span, not "three years."
  if (!best || bestGap > 200 * 86400000) return null
  return best.revenue
}

const SPLIT_FACTORS = [3, 4, 5, 6, 8, 10, 20, 25, 50]

function nearSplit(ratio: number): number | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null
  for (const factor of SPLIT_FACTORS) {
    if (Math.abs(ratio - factor) / factor <= 0.025) return factor
    if (Math.abs(ratio - 1 / factor) / (1 / factor) <= 0.025) return 1 / factor
  }
  return null
}

function splitName(factor: number): string {
  return factor >= 1 ? `${Math.round(factor)}-for-1` : `1-for-${Math.round(1 / factor)}`
}

function shareChange(points: AnnualPoint[]): { change: number | null; splits: string[]; unread: string | null } {
  const empty = { change: null, splits: [] as string[], unread: null as string | null }
  if (points.length < 2 || !points[0]?.val) return empty
  const latest = points[0]
  const target = Date.parse(latest.end) - 5 * 365.25 * 86400000
  let scale = 1
  const splits: string[] = []
  let best: { val: number } | null = null
  let bestGap = Infinity
  for (let i = 1; i < points.length; i++) {
    if (Date.parse(points[i].end) < target - 200 * 86400000) break
    const newer = points[i - 1].val
    const older = points[i].val
    if (!newer || !older) {
      return {
        change: null,
        splits,
        unread: `The share count for ${points[i].end.slice(0, 4)} is not a usable count, so the five-year change was left blank.`,
      }
    }
    const ratio = newer / older
    if (!Number.isFinite(ratio)) {
      return {
        change: null,
        splits,
        unread: `The share count for ${points[i].end.slice(0, 4)} is not a usable count, so the five-year change was left blank.`,
      }
    }
    const split = nearSplit(ratio)
    if (split) {
      scale *= split
      splits.push(splitName(split))
    } else if (ratio >= 5 || ratio <= 0.2) {
      const factor = ratio >= 1 ? ratio : 1 / ratio
      return {
        change: null,
        splits,
        unread: `The share count moved by a factor of ${factor.toFixed(1)} in ${points[i].end.slice(0, 4)}, and it is not a stock split this desk can see, so the five-year change was left blank.`,
      }
    }
    const gap = Math.abs(Date.parse(points[i].end) - target)
    if (gap < bestGap) {
      best = { val: older * scale }
      bestGap = gap
    }
  }
  if (!best?.val || bestGap > 200 * 86400000) return { change: null, splits, unread: null }
  const ratio = latest.val / best.val
  if (ratio >= 25 || ratio <= 1 / 25) return { change: null, splits, unread: null }
  return { change: latest.val / best.val - 1, splits, unread: null }
}

const STATEMENT_DAYS = 45
const DAY_MS = 86400000

function onStatement(end: string, anchor: string | null): boolean {
  if (!anchor) return true
  const gap = Math.abs(Date.parse(end) - Date.parse(anchor))
  return Number.isFinite(gap) && gap <= STATEMENT_DAYS * DAY_MS
}

function valueOnStatement(points: AnnualPoint[], anchor: string | null): number | null {
  if (!points.length) return null
  if (!anchor) return points[0].val
  let best: AnnualPoint | null = null
  let bestGap = Infinity
  for (const point of points) {
    const gap = Math.abs(Date.parse(point.end) - Date.parse(anchor))
    if (!Number.isFinite(gap) || gap > STATEMENT_DAYS * DAY_MS) continue
    if (gap < bestGap) {
      best = point
      bestGap = gap
    }
  }
  return best?.val ?? null
}

function dated(facts: CompanyFacts, name: string, kind: "flow" | "instant"): AnnualPoint | null {
  return annualSeries(facts, [name], kind)[0] ?? null
}

function onAnchor(facts: CompanyFacts, name: string, kind: "flow" | "instant", anchor: string | null): number | null {
  const point = dated(facts, name, kind)
  if (!point || !onStatement(point.end, anchor)) return null
  return point.val
}

function closeTo(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b))
  if (scale === 0) return true
  return Math.abs(a - b) / scale < 0.02
}

const DEBT_TAGS = [
  "LongTermDebt",
  "LongTermDebtNoncurrent",
  "LongTermDebtCurrent",
  "DebtCurrent",
  "ShortTermBorrowings",
  "CommercialPaper",
  "DebtAndCapitalLeaseObligations",
  "LongTermDebtAndCapitalLeaseObligations",
  "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
  "DebtLongtermAndShorttermCombinedAmount",
]

function readDebt(facts: CompanyFacts, anchor: string | null): { debt: number; stale: boolean; filed: boolean } | { debt: null; stale: boolean; filed: boolean } {
  const longDebt = onAnchor(facts, "LongTermDebt", "instant", anchor)
  const noncurrent = onAnchor(facts, "LongTermDebtNoncurrent", "instant", anchor)
  const current = onAnchor(facts, "LongTermDebtCurrent", "instant", anchor)
  const debtCurrent = onAnchor(facts, "DebtCurrent", "instant", anchor)
  const paper = onAnchor(facts, "CommercialPaper", "instant", anchor)
  const short = onAnchor(facts, "ShortTermBorrowings", "instant", anchor)
  const including = onAnchor(facts, "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities", "instant", anchor)
  const combined = onAnchor(facts, "DebtLongtermAndShorttermCombinedAmount", "instant", anchor)
  const obligations = onAnchor(facts, "DebtAndCapitalLeaseObligations", "instant", anchor)
  const noncurrentLeases = onAnchor(facts, "LongTermDebtAndCapitalLeaseObligations", "instant", anchor)
  const currentPortion = current ?? debtCurrent

  let core: number | null = null
  let extrasOutside = true
  if (longDebt != null) {
    core = longDebt
    const pieces = (noncurrent ?? 0) + (currentPortion ?? 0)
    const withExtras = pieces + Math.max(short ?? 0, 0) + Math.max(paper ?? 0, 0)
    if (pieces > 0 && closeTo(withExtras, longDebt)) extrasOutside = false
  } else if (noncurrent != null && currentPortion != null) {
    core = noncurrent + currentPortion
  } else if (including != null) {
    core = including
    extrasOutside = false
  } else if (combined != null) {
    core = combined
    extrasOutside = false
  } else if (obligations != null) {
    core = obligations
    extrasOutside = false
  } else if (noncurrentLeases != null && currentPortion != null) {
    core = noncurrentLeases + currentPortion
  } else if (noncurrent != null) {
    core = noncurrent
  } else if (noncurrentLeases != null) {
    core = noncurrentLeases
  } else if (currentPortion != null) {
    core = currentPortion
  }

  let stale = false
  for (const name of DEBT_TAGS) {
    const point = dated(facts, name, "instant")
    if (!point || onStatement(point.end, anchor)) continue
    if (point.val !== 0) stale = true
  }

  if (core == null) {
    if (stale) return { debt: null, stale: true, filed: false }
    return { debt: 0, stale: false, filed: false }
  }

  if (!extrasOutside) return { debt: core, stale: false, filed: true }

  let paperExtra = paper != null && paper > 0 ? paper : 0
  let shortExtra = short != null && short > 0 ? short : 0
  if (currentPortion != null && currentPortion > 0 && shortExtra > 0 && closeTo(shortExtra, currentPortion)) shortExtra = 0
  if (paperExtra > 0 && shortExtra > 0 && closeTo(paperExtra, shortExtra)) shortExtra = 0
  let extra = paperExtra + shortExtra
  const ceiling = combined ?? obligations ?? including
  if (ceiling != null && extra > 0 && core + extra > ceiling * 1.02) extra = 0
  return { debt: core + extra, stale: false, filed: true }
}

function readLiquid(facts: CompanyFacts, anchor: string | null): number | null {
  const combined = onAnchor(facts, "CashCashEquivalentsAndShortTermInvestments", "instant", anchor)
  if (combined != null) return combined
  const cash = onAnchor(facts, "CashAndCashEquivalentsAtCarryingValue", "instant", anchor)
    ?? onAnchor(facts, "Cash", "instant", anchor)
  const securities = onAnchor(facts, "ShortTermInvestments", "instant", anchor)
    ?? onAnchor(facts, "MarketableSecuritiesCurrent", "instant", anchor)
    ?? onAnchor(facts, "AvailableForSaleSecuritiesCurrent", "instant", anchor)
    ?? onAnchor(facts, "AvailableForSaleSecuritiesDebtMaturitiesWithinOneYearFairValue", "instant", anchor)
  if (cash != null) return cash + Math.max(securities ?? 0, 0)
  const restricted = onAnchor(facts, "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "instant", anchor)
  if (restricted == null && securities == null) return null
  return (restricted ?? 0) + Math.max(securities ?? 0, 0)
}

export function buildMetrics(input: {
  company: Company
  facts: CompanyFacts
  submissions: Submissions | null
  quote: Quote | null
}): Metrics {
  const { company, facts, submissions, quote } = input
  const warnings: string[] = []

  const revenueTags = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "RegulatedAndUnregulatedOperatingRevenue",
  ]
  const revenuePts = revenueSeries(facts, revenueTags)
  const statementCurrency = reportingCurrency(facts, revenueTags)
  const incomePts = annualSeries(facts, ["NetIncomeLoss"], "flow")
  const operatingPts = annualSeries(facts, ["OperatingIncomeLoss"], "flow")
  const grossPts = annualSeries(facts, ["GrossProfit"], "flow")
  const costOfRevenuePts = annualSeries(facts, ["CostOfRevenue"], "flow")
  const cogsPts = annualSeries(facts, ["CostOfGoodsAndServicesSold"], "flow")
  const equityPts = annualSeries(facts, [
    "StockholdersEquity",
    "StockholdersEquityAttributableToParent",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ], "instant")
  const assetPts = annualSeries(facts, ["Assets"], "instant")
  const liabilityPts = annualSeries(facts, ["Liabilities"], "instant")
  const currentAssetPts = annualSeries(facts, ["AssetsCurrent"], "instant")
  const currentLiabilityPts = annualSeries(facts, ["LiabilitiesCurrent"], "instant")
  const cfoPts = annualSeries(facts, ["NetCashProvidedByUsedInOperatingActivities"], "flow")
  const capexPts = annualSeries(facts, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsToAcquireOtherProductiveAssets",
  ], "flow")
  const epsPts = annualSeries(facts, ["EarningsPerShareDiluted"], "flow")
  const sharePts = annualSeries(facts, [
    "CommonStockSharesOutstanding",
    "CommonStockSharesIssuedAndOutstanding",
  ], "instant")
  const dilutedPts = annualSeries(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"], "flow")
  const dpsPts = annualSeries(facts, ["CommonStockDividendsPerShareDeclared"], "flow")
  const dividendPts = annualSeries(facts, ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], "flow")

  const fiscalAnchor = revenuePts[0]?.end ?? incomePts[0]?.end ?? cfoPts[0]?.end ?? null
  const debtRead = readDebt(facts, fiscalAnchor)
  let debt = debtRead.debt
  const liquid = readLiquid(facts, fiscalAnchor)

  const revenueMap = byEnd(revenuePts)
  const incomeMap = byEnd(incomePts)
  const operatingMap = byEnd(operatingPts)
  const grossMap = byEnd(grossPts)
  const costOfRevenueMap = byEnd(costOfRevenuePts)
  const cogsMap = byEnd(cogsPts)
  const equityMap = byEnd(equityPts)
  const grossAt = (end: string, revenue: number | null): { value: number | null; derived: boolean } => {
    if (revenue == null || revenue <= 0) return { value: null, derived: false }
    const tagged = grossMap.get(end)
    if (tagged != null) return { value: tagged, derived: false }
    // Cost of revenue matched the tagged gross profit wherever both were filed. Cost of goods is used only when it is most of the sales dollar, so a stray component is not turned into a margin.
    const costOfRevenue = costOfRevenueMap.get(end)
    if (costOfRevenue != null && costOfRevenue > 0 && costOfRevenue < revenue) return { value: revenue - costOfRevenue, derived: true }
    const cogs = cogsMap.get(end)
    if (cogs != null && cogs > 0 && cogs / revenue >= 0.15 && cogs / revenue <= 0.9) return { value: revenue - cogs, derived: true }
    return { value: null, derived: false }
  }
  const anchors = (revenuePts.length ? revenuePts : incomePts).slice(0, 8)
  const series: YearPoint[] = anchors.map((point) => {
    const revenue = revenueMap.get(point.end) ?? null
    const operatingIncome = operatingMap.get(point.end) ?? null
    const gross = grossAt(point.end, revenue)
    const endYear = Number(point.end.slice(0, 4))
    return {
      end: point.end,
      fy: point.fy != null && point.fy === endYear ? point.fy : null,
      revenue,
      netIncome: incomeMap.get(point.end) ?? null,
      operatingIncome,
      operatingMargin: revenue && operatingIncome != null ? operatingIncome / revenue : null,
      grossMargin: gross.value != null && revenue ? gross.value / revenue : null,
      equity: equityMap.get(point.end) ?? null,
    }
  })

  const stated = series.find((year) => year.end === fiscalAnchor) ?? series.find((year) => year.revenue != null) ?? null
  const revenue = stated?.revenue ?? null
  const netIncome = stated?.netIncome ?? null
  const operatingIncome = stated?.operatingIncome ?? null
  const grossRead = stated ? grossAt(stated.end, stated.revenue) : { value: null, derived: false }
  const grossProfit = grossRead.value
  const equity = valueOnStatement(equityPts, fiscalAnchor)
  const equityStale = equity == null && Boolean(equityPts[0])
  const liabilities = valueOnStatement(liabilityPts, fiscalAnchor)
  const liabilitiesStale = liabilities == null && Boolean(liabilityPts[0])
  const assets = valueOnStatement(assetPts, fiscalAnchor)
  const deposits = onAnchor(facts, "Deposits", "instant", fiscalAnchor)
    ?? onAnchor(facts, "DepositsInterestBearing", "instant", fiscalAnchor)
  if (!debtRead.filed && debt === 0) {
    const liabilityShare = liabilities != null && assets != null && assets > 0 ? liabilities / assets : null
    if ((deposits ?? 0) > 0) {
      debt = null
      warnings.push("Deposits are on the balance sheet. Borrowings were not, so debt was left blank rather than treated as zero.")
    } else if (liabilityShare != null && liabilityShare > 0.5 && liabilityShare <= 1.5) {
      debt = null
      warnings.push("Borrowings were not in the filing feed, and liabilities are most of the assets, so debt was left blank rather than treated as zero.")
    }
  }
  if (debt === 0) {
    const leaseTotal = onAnchor(facts, "OperatingLeaseLiability", "instant", fiscalAnchor)
    const leaseCurrent = onAnchor(facts, "OperatingLeaseLiabilityCurrent", "instant", fiscalAnchor)
    const leaseLong = onAnchor(facts, "OperatingLeaseLiabilityNoncurrent", "instant", fiscalAnchor)
    const lease = leaseTotal != null && leaseTotal > 0
      ? leaseTotal
      : (leaseCurrent ?? 0) + (leaseLong ?? 0) > 0
        ? (leaseCurrent ?? 0) + (leaseLong ?? 0)
        : null
    if (lease != null) {
      debt = lease
      warnings.push("Borrowings were not drawn. Debt is the operating lease liability on the balance sheet.")
    }
  }
  const currentAssets = valueOnStatement(currentAssetPts, fiscalAnchor)
  const currentLiabilities = valueOnStatement(currentLiabilityPts, fiscalAnchor)
  const cfo = valueOnStatement(cfoPts, fiscalAnchor)
  const capexOnStatement = valueOnStatement(capexPts, fiscalAnchor)
  const capexStale = capexOnStatement == null && Boolean(capexPts[0])
  // No capital-spending tag is an unknown, not a year in which the company spent nothing.
  const capexMissing = capexPts.length === 0
  const capex = capexOnStatement == null ? null : Math.abs(capexOnStatement)
  const eps = valueOnStatement(epsPts, fiscalAnchor)
  const shareOnStatement = valueOnStatement(sharePts, fiscalAnchor)
  const dilutedOnStatement = valueOnStatement(dilutedPts, fiscalAnchor)
  const dilutedIsNewer = shareOnStatement == null && dilutedOnStatement != null
  const shares = shareOnStatement ?? dilutedOnStatement
  const dps = valueOnStatement(dpsPts, fiscalAnchor)
  const dividends = valueOnStatement(dividendPts, fiscalAnchor)

  const price = quote?.price ?? null
  const currency = quote?.currency ?? "USD"
  const aligned = statementCurrency == null || statementCurrency === currency
  const marketCap = price != null && shares ? price * shares : null
  const fcf = cfo == null || capex == null ? null : cfo - capex
  // Cash from operations with the spending left off is not owner earnings, and neither is relabeling the profit.
  const ownerEarnings = fcf ?? (capexStale || (capexMissing && cfo != null) ? null : netIncome)
  const enterpriseValue =
    marketCap == null || debt == null || liquid == null ? null : marketCap + debt - liquid
  const pe = price != null && eps != null && eps > 0 ? price / eps : null
  const pb = marketCap != null && equity != null && equity > 0 ? marketCap / equity : null
  const fcfYield = fcf != null && marketCap ? fcf / marketCap : null
  const earningsYield =
    operatingIncome != null && enterpriseValue != null && enterpriseValue > 0
      ? operatingIncome / enterpriseValue
      : null
  const roe = netIncome != null && equity != null && equity > 0 ? netIncome / equity : null
  const capital = equity != null && debt != null && liquid != null ? equity + debt - liquid : null
  const roic =
    operatingIncome != null && capital != null && capital > 0 ? (operatingIncome * 0.79) / capital : null
  const grossMargin = grossProfit != null && revenue ? grossProfit / revenue : null
  const operatingMargin = operatingIncome != null && revenue ? operatingIncome / revenue : null
  const currentRatio =
    currentAssets != null && currentLiabilities ? currentAssets / currentLiabilities : null
  const debtToEquity = debt != null && equity != null && equity > 0 ? debt / equity : null
  const dividendYield =
    dps != null && price ? dps / price : dividends != null && marketCap ? Math.abs(dividends) / marketCap : null
  const bookPerShare = equity != null && shares ? equity / shares : null
  const workingCapital =
    currentAssets != null && currentLiabilities != null ? currentAssets - currentLiabilities : null
  const ncav = currentAssets != null && liabilities != null ? currentAssets - liabilities : null
  const ncavPerShare = ncav != null && shares ? ncav / shares : null
  const grahamNumber =
    eps != null && eps > 0 && bookPerShare != null && bookPerShare > 0
      ? Math.sqrt(22.5 * eps * bookPerShare)
      : null

  const roeYears: number[] = []
  for (const year of series.slice(0, 5)) {
    if (year.netIncome == null || year.equity == null || year.equity <= 0) continue
    // A book smaller than that year's earnings has been paid down. The ratio is not a return.
    if (year.netIncome > year.equity) continue
    roeYears.push(year.netIncome / year.equity)
  }
  const roeAvg = roeYears.length ? roeYears.reduce((sum, n) => sum + n, 0) / roeYears.length : null

  const marginHistory = series
    .map((year) => year.operatingMargin)
    .filter((value): value is number => value != null)
  const grossHistory = series
    .map((year) => year.grossMargin)
    .filter((value): value is number => value != null)
  const currentOperatingMargin = marginHistory[0] ?? null
  const priorOperatingMargin = marginHistory[1] ?? null
  const olderMargins = marginHistory.slice(1)
  const normalOperatingMargin = median(olderMargins.length ? olderMargins : marginHistory)
  const grossMarginCv = cv(grossHistory)

  const incomeWindow = incomePts.slice(0, 10)
  const positiveEarningsYears = incomeWindow.filter((point) => point.val > 0).length
  const earningsYears = incomeWindow.length

  const revenueNow = series[0]?.revenue ?? null
  const revenueThen = revenueAbout(series, 3)
  const revenueChange3y = change(revenueNow, revenueThen)
  const oldest = series[series.length - 1]
  const span = series[0] && oldest ? yearsBetween(series[0].end, oldest.end) : null
  const revenueCagr =
    span && span >= 2 && revenueNow != null && oldest?.revenue != null && oldest.revenue > 0
      ? (revenueNow / oldest.revenue) ** (1 / span) - 1
      : null
  const peakRevenue = series.reduce<number | null>((peak, year) => {
    if (year.revenue == null) return peak
    return peak == null ? year.revenue : Math.max(peak, year.revenue)
  }, null)

  const fiscal = revenuePts[0] ?? incomePts[0] ?? equityPts[0]
  const fiscalEnd = fiscal?.end ?? null
  const fiscalYear = fiscal?.fy ?? null
  if (fiscalEnd && Date.now() - Date.parse(fiscalEnd) > 450 * 86400000) {
    warnings.push(`The latest annual facts end ${fiscalEnd}, so the ratios are older than the price.`)
  }
  if (!quote) warnings.push("The market price didn't load. Rubric totals that need a price are withheld.")
  if (price != null && shares != null && revenue != null && shares < 1e7 && price * shares < revenue * 0.02) {
    warnings.push("The share count looks too small beside revenue. Per-share figures and market cap may be scaled oddly in the filing.")
  }
  const dropped = [
    debtRead.stale ? "debt" : null,
    equityStale ? "equity" : null,
    liabilitiesStale ? "liabilities" : null,
    capexStale ? "capital spending" : null,
    grossPts[0] && grossProfit == null ? "gross profit" : null,
  ].filter((item): item is string => item != null)
  if (dropped.length) {
    const line = dropped.length === 1 ? dropped[0] : `${dropped.slice(0, -1).join(", ")} and ${dropped[dropped.length - 1]}`
    warnings.push(`The ${line} figure${dropped.length === 1 ? "" : "s"} in the filing feed ${dropped.length === 1 ? "is" : "are"} from a different statement than the latest results, so ${dropped.length === 1 ? "it was" : "they were"} left blank.`)
  }
  if (capexMissing && cfo != null) {
    warnings.push("Capital spending is not in the filing feed, so free cash flow was left blank rather than treating the spending as zero.")
  }
  if (dilutedIsNewer) {
    warnings.push("Share count is the diluted average. The year-end outstanding count is missing or older.")
  }
  if (grossRead.derived) {
    warnings.push("Gross profit was not tagged. It is revenue minus the cost line on the same statement.")
  }
  const sharesOverTime = shareChange(sharePts.length ? sharePts : dilutedPts)
  if (sharesOverTime.unread) warnings.push(sharesOverTime.unread)
  else if (sharesOverTime.splits.length && sharesOverTime.change != null) {
    const named = sharesOverTime.splits.join(" and ")
    warnings.push(sharesOverTime.splits.length === 1
      ? `A ${named} share split was taken out of the five-year share count.`
      : `Share splits (${named}) were taken out of the five-year share count.`)
  }
  if (roe != null && roe > 1) {
    warnings.push("Earnings are larger than the equity. The book has been paid down, so that return is not used as the multi-year return on the business.")
  }
  if (!aligned && statementCurrency) {
    warnings.push(`The statements are in ${statementCurrency} and the quote is in ${currency}. Price ratios are withheld, because this feed has no exchange rate from the filing.`)
  }

  const filingRead = readFilings(submissions, company.cik)
  if (!submissions) warnings.push("Recent filing list didn't load. Catalyst checks are blank.")

  return {
    ticker: company.ticker,
    name: company.name,
    cik: company.cik,
    priced: price != null,
    price,
    previousClose: quote?.previousClose ?? null,
    changePercent: quote?.changePercent ?? null,
    currency,
    statementCurrency,
    asOf: quote?.asOf ?? null,
    fiscalYear,
    fiscalEnd,
    shares,
    marketCap,
    enterpriseValue: aligned ? enterpriseValue : null,
    revenue,
    netIncome,
    eps,
    operatingIncome,
    grossProfit,
    equity,
    liabilities,
    currentAssets,
    currentLiabilities,
    debt,
    cash: liquid,
    cfo,
    capex: capex == null ? null : Math.abs(capex),
    fcf,
    ownerEarnings,
    pe: aligned ? pe : null,
    pb: aligned ? pb : null,
    fcfYield: aligned ? fcfYield : null,
    earningsYield: aligned ? earningsYield : null,
    roe,
    roeAvg,
    roic,
    grossMargin,
    operatingMargin,
    currentRatio,
    debtToEquity,
    dividendYield: aligned ? dividendYield : null,
    bookPerShare: aligned ? bookPerShare : null,
    ncavPerShare: aligned ? ncavPerShare : null,
    grahamNumber: aligned ? grahamNumber : null,
    workingCapital,
    positiveEarningsYears,
    earningsYears,
    shareChange5y: sharesOverTime.change,
    revenueChange3y,
    revenueCagr,
    grossMarginCv,
    normalOperatingMargin,
    currentOperatingMargin,
    priorOperatingMargin,
    peakRevenue,
    series,
    filings: filingRead.filings,
    filingsLoaded: submissions != null,
    schedule13d: filingRead.schedule13d,
    insiderForms: filingRead.insiderForms,
    warnings,
  }
}

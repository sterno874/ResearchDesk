import { annualSeries, readFilings, type Company, type CompanyFacts, type Submissions } from "./sec"
import { cv, median } from "./stats"
import type { Metrics, Quote, YearPoint } from "./types"
import type { AnnualPoint } from "./sec"

function byEnd(points: AnnualPoint[]): Map<string, number> {
  return new Map(points.map((point) => [point.end, point.val]))
}

function latest(points: AnnualPoint[]): number | null {
  return points[0]?.val ?? null
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

function shareChange(points: AnnualPoint[]): number | null {
  if (points.length < 2) return null
  const now = points[0]
  const target = new Date(now.end)
  target.setFullYear(target.getFullYear() - 5)
  const targetIso = target.toISOString().slice(0, 10)
  const then = points.find((point) => point.end <= targetIso)
  if (!then || then.val === 0) return null
  return now.val / then.val - 1
}

export function buildMetrics(input: {
  company: Company
  facts: CompanyFacts
  submissions: Submissions | null
  quote: Quote | null
}): Metrics {
  const { company, facts, submissions, quote } = input
  const warnings: string[] = []

  const revenuePts = annualSeries(facts, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "RegulatedAndUnregulatedOperatingRevenue",
  ], "flow")
  const incomePts = annualSeries(facts, ["NetIncomeLoss"], "flow")
  const operatingPts = annualSeries(facts, ["OperatingIncomeLoss"], "flow")
  const grossPts = annualSeries(facts, ["GrossProfit"], "flow")
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
  ], "flow")
  const epsPts = annualSeries(facts, ["EarningsPerShareDiluted"], "flow")
  const sharePts = annualSeries(facts, [
    "CommonStockSharesOutstanding",
    "CommonStockSharesIssuedAndOutstanding",
  ], "instant")
  const dilutedPts = annualSeries(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"], "flow")
  const dpsPts = annualSeries(facts, ["CommonStockDividendsPerShareDeclared"], "flow")
  const dividendPts = annualSeries(facts, ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], "flow")

  const longDebt = latest(annualSeries(facts, ["LongTermDebt"], "instant"))
  const debtNoncurrent = latest(annualSeries(facts, ["LongTermDebtNoncurrent"], "instant"))
  const debtCurrent = latest(annualSeries(facts, ["LongTermDebtCurrent"], "instant"))
  const shortBorrow = latest(annualSeries(facts, ["ShortTermBorrowings"], "instant"))
  const paper = latest(annualSeries(facts, ["CommercialPaper"], "instant"))
  const debt =
    debtNoncurrent != null || debtCurrent != null || shortBorrow != null || paper != null
      ? (debtNoncurrent ?? 0) + (debtCurrent ?? 0) + (shortBorrow ?? 0) + (paper ?? 0)
      : longDebt

  const cash = latest(annualSeries(facts, ["CashAndCashEquivalentsAtCarryingValue", "Cash"], "instant"))
  const cashAndInvestments = latest(annualSeries(facts, ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashCashEquivalentsAndShortTermInvestments"], "instant"))
  const liquid = cashAndInvestments ?? cash

  const revenueMap = byEnd(revenuePts)
  const incomeMap = byEnd(incomePts)
  const operatingMap = byEnd(operatingPts)
  const grossMap = byEnd(grossPts)
  const equityMap = byEnd(equityPts)
  const anchors = (revenuePts.length ? revenuePts : incomePts).slice(0, 8)
  const series: YearPoint[] = anchors.map((point) => {
    const revenue = revenueMap.get(point.end) ?? null
    const operatingIncome = operatingMap.get(point.end) ?? null
    const grossProfit = grossMap.get(point.end) ?? null
    const endYear = Number(point.end.slice(0, 4))
    return {
      end: point.end,
      fy: point.fy != null && point.fy === endYear ? point.fy : null,
      revenue,
      netIncome: incomeMap.get(point.end) ?? null,
      operatingIncome,
      operatingMargin: revenue && operatingIncome != null ? operatingIncome / revenue : null,
      grossMargin: revenue && grossProfit != null ? grossProfit / revenue : null,
      equity: equityMap.get(point.end) ?? null,
    }
  })

  const revenue = series.find((year) => year.revenue != null)?.revenue ?? latest(revenuePts)
  const netIncome = series.find((year) => year.netIncome != null)?.netIncome ?? latest(incomePts)
  const operatingIncome = series.find((year) => year.operatingIncome != null)?.operatingIncome ?? latest(operatingPts)
  const grossProfit = latest(grossPts)
  const fiscalAnchor = revenuePts[0]?.end ?? incomePts[0]?.end ?? null
  const equityStale = Boolean(
    fiscalAnchor && equityPts[0] && Date.parse(fiscalAnchor) - Date.parse(equityPts[0].end) > 500 * 86400000,
  )
  const equity = equityStale ? null : latest(equityPts)
  const liabilities = latest(liabilityPts)
  const currentAssets = latest(currentAssetPts)
  const currentLiabilities = latest(currentLiabilityPts)
  const cfo = latest(cfoPts)
  const capex = latest(capexPts)
  const eps = latest(epsPts)
  const dilutedIsNewer = (dilutedPts[0]?.end ?? "") > (sharePts[0]?.end ?? "")
  const shares = dilutedIsNewer ? latest(dilutedPts) : latest(sharePts) ?? latest(dilutedPts)
  const dpsFresh = Boolean(fiscalAnchor && dpsPts[0] && Date.parse(fiscalAnchor) - Date.parse(dpsPts[0].end) < 500 * 86400000)
  const dividendFresh = Boolean(fiscalAnchor && dividendPts[0] && Date.parse(fiscalAnchor) - Date.parse(dividendPts[0].end) < 500 * 86400000)
  const dps = dpsFresh ? latest(dpsPts) : null
  const dividends = dividendFresh ? latest(dividendPts) : null

  const price = quote?.price ?? null
  const currency = quote?.currency ?? "USD"
  const marketCap = price != null && shares ? price * shares : null
  const fcf = cfo == null ? null : cfo - Math.abs(capex ?? 0)
  const ownerEarnings = fcf ?? netIncome
  const enterpriseValue =
    marketCap == null ? null : marketCap + (debt ?? 0) - (liquid ?? 0)
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
  for (const year of series) {
    if (year.netIncome != null && year.equity != null && year.equity > 0) {
      roeYears.push(year.netIncome / year.equity)
    }
    if (roeYears.length >= 5) break
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
  const revenueThen = series[Math.min(3, series.length - 1)]?.revenue ?? null
  const revenueChange3y = series.length >= 3 ? change(revenueNow, revenueThen) : null
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
  if (equityStale) {
    warnings.push("Equity in the XBRL feed is much older than the income statement, so book value is left blank rather than taken from a stale line.")
  }
  if (dilutedIsNewer || (!sharePts.length && dilutedPts.length)) {
    warnings.push("Share count is the diluted average. The year-end outstanding count is missing or older.")
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
    asOf: quote?.asOf ?? null,
    fiscalYear,
    fiscalEnd,
    shares,
    marketCap,
    enterpriseValue,
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
    pe,
    pb,
    fcfYield,
    earningsYield,
    roe,
    roeAvg,
    roic,
    grossMargin,
    operatingMargin,
    currentRatio,
    debtToEquity,
    dividendYield,
    bookPerShare,
    ncavPerShare,
    grahamNumber,
    workingCapital,
    positiveEarningsYears,
    earningsYears,
    shareChange5y: shareChange(sharePts.length ? sharePts : dilutedPts),
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

import { money, plainPct, price, ratio } from "./format"
import { round, scale } from "./stats"
import type { InvestorScore, Metrics, Part, SectorId } from "./types"

const VERDICTS: Record<string, [string, string, string, string, string]> = {
  munger: ["Not his game", "He would pass", "Interested, with a condition", "He would take it seriously", "He would own it"],
  buffett: ["Not a Buffett business", "He would pass", "He would haggle", "He would take it seriously", "He would own it"],
  graham: ["No margin of safety", "Too rich for the checklist", "Some cheapness, not enough", "The checklist mostly clears", "A statistical bargain"],
  klarman: ["Downside is not protected", "He would wait", "Cheap, but the path is thin", "Downside is covered", "The asymmetry is his kind"],
  schloss: ["Not cheap enough", "He would skip it", "A possible basket name", "Cheap on the assets", "The kind of cheap he bought"],
  greenblatt: ["Fails the formula", "A weak pair", "Ordinary on both", "Both sides are good", "A magic-formula name"],
}

function band(score: number): number {
  if (score < 36) return 0
  if (score < 52) return 1
  if (score < 68) return 2
  if (score < 80) return 3
  return 4
}

/** A heavy part that fails keeps the verdict from sounding like a buy. */
function verdictIndex(score: number, parts: Part[]): number {
  const index = band(score)
  const heavyFail = parts.some((item) => item.score != null && item.weight >= 0.18 && item.score <= 3)
  return heavyFail ? Math.min(index, 2) : index
}

function part(id: string, label: string, weight: number, score: number | null, reading: string, note: string): Part {
  return {
    id,
    label,
    weight,
    score: score == null ? null : round(Math.min(10, Math.max(0, score)), 1),
    reading,
    note,
  }
}

function combine(parts: Part[], priced: boolean): number | null {
  if (!priced) return null
  let weight = 0
  let total = 0
  for (const item of parts) {
    if (item.score == null) continue
    weight += item.weight
    total += item.weight * item.score
  }
  if (weight === 0) return null
  return Math.round((total / weight) * 10)
}

function lead(parts: Part[]): { best: Part | null; worst: Part | null } {
  const scored = parts.filter((item) => item.score != null)
  if (!scored.length) return { best: null, worst: null }
  const sorted = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return { best: sorted[0], worst: sorted[sorted.length - 1] }
}

function finish(id: string, name: string, era: string, metrics: Metrics, parts: Part[], extraVerdict?: string): InvestorScore {
  const score = combine(parts, metrics.priced)
  const { best, worst } = lead(parts)
  const verdict = !metrics.priced
    ? "Needs a price"
    : extraVerdict ?? (score == null ? "Not enough filings" : VERDICTS[id][verdictIndex(score, parts)])
  let summary = "The filing is too thin to score this rubric."
  let deciding = "Nothing in the filing decides it."
  if (best && worst) {
    summary = `${best.label} is the attraction (${best.reading}). ${worst.label} is the objection (${worst.reading}).`
    if (best.id === worst.id) summary = `${best.label} is the only part with a reading (${best.reading}).`
    const spread = (best.score ?? 0) - (worst.score ?? 0)
    if (spread < 1.5) deciding = "No single part decides it. The readings sit in a band."
    else if ((worst.score ?? 10) <= 4) deciding = `The part that decides it is ${worst.label.toLowerCase()}.`
    else deciding = `The part that decides it is ${best.label.toLowerCase()}.`
  }
  if (!metrics.priced) {
    summary = "The filings are here. Without a market price, a total would pretend the cheapness test had been run."
    deciding = "Price is the missing part."
  }
  return { id, name, era, score, verdict, summary, deciding, parts }
}

function debtScore(metrics: Metrics): number | null {
  if (metrics.debtToEquity == null) return null
  return scale(metrics.debtToEquity, [
    { at: 0, score: 10 },
    { at: 0.3, score: 8 },
    { at: 0.7, score: 5.5 },
    { at: 1.2, score: 3 },
    { at: 2.5, score: 1 },
    { at: 4, score: 0 },
  ])
}

function dilutionScore(metrics: Metrics): number | null {
  if (metrics.shareChange5y == null) return null
  return scale(metrics.shareChange5y, [
    { at: -0.25, score: 10 },
    { at: -0.05, score: 8.5 },
    { at: 0.02, score: 6 },
    { at: 0.12, score: 3 },
    { at: 0.3, score: 0 },
  ])
}

function shrinkScore(metrics: Metrics): number | null {
  if (metrics.revenueChange3y == null) return null
  return scale(metrics.revenueChange3y, [
    { at: -0.4, score: 0 },
    { at: -0.15, score: 2 },
    { at: -0.05, score: 4 },
    { at: 0.02, score: 7 },
    { at: 0.1, score: 9 },
    { at: 0.2, score: 10 },
  ])
}

function earningsRecord(metrics: Metrics): number | null {
  if (!metrics.earningsYears) return null
  return scale(metrics.positiveEarningsYears / metrics.earningsYears, [
    { at: 0.4, score: 0 },
    { at: 0.7, score: 4 },
    { at: 0.9, score: 7 },
    { at: 1, score: 10 },
  ])
}

function mungerPrice(metrics: Metrics): { score: number | null; note: string } {
  if (metrics.fcfYield == null) return { score: null, note: "Free cash flow or the share price is missing, so the price test is blank." }
  let score = scale(metrics.fcfYield, [
    { at: 0.015, score: 0 },
    { at: 0.025, score: 1.5 },
    { at: 0.035, score: 3.5 },
    { at: 0.05, score: 6 },
    { at: 0.07, score: 8.5 },
    { at: 0.09, score: 10 },
  ])
  const wonderful = (metrics.roic ?? 0) >= 0.15 && (metrics.grossMargin ?? 0) >= 0.3
  const ordinary = (metrics.roic ?? 0) < 0.1 && (metrics.grossMargin ?? 0) < 0.25
  if (wonderful && metrics.fcfYield >= 0.03) score += 1.2
  if (ordinary && metrics.fcfYield < 0.08) score -= 1.5
  let note: string
  if (metrics.fcfYield < 0.035 && wonderful) {
    note = "The business is the kind he likes. At this yield a buyer is paying for a lot of the future up front. He would call that a full price, and often pass."
  } else if (metrics.fcfYield < 0.04 && ordinary) {
    note = "The yield is thin, and the business has not earned the right to be expensive. That is being wrong twice."
  } else if (metrics.fcfYield >= 0.06 && !ordinary) {
    note = "A real yield on a business that earns its capital. This is the part he would lean toward."
  } else if (metrics.fcfYield < 0) {
    note = "Free cash flow is negative. He would not pay for a story about cash that is not in the filing."
  } else {
    note = "He compares the yield with what a good business offers elsewhere. This sits in the middle of that comparison."
  }
  return { score, note }
}

function scoreMunger(metrics: Metrics): InvestorScore {
  const pricePart = mungerPrice(metrics)
  const roc = metrics.roic == null
    ? null
    : scale(metrics.roic, [
        { at: 0, score: 0 },
        { at: 0.08, score: 3 },
        { at: 0.15, score: 6.5 },
        { at: 0.25, score: 8.5 },
        { at: 0.4, score: 10 },
      ])
  const margin = metrics.grossMargin == null
    ? null
    : scale(metrics.grossMargin, [
        { at: 0.1, score: 1 },
        { at: 0.25, score: 4 },
        { at: 0.4, score: 7 },
        { at: 0.55, score: 9 },
        { at: 0.7, score: 10 },
      ])
  const stability = metrics.grossMarginCv == null
    ? null
    : scale(metrics.grossMarginCv, [
        { at: 0.04, score: 10 },
        { at: 0.1, score: 8 },
        { at: 0.2, score: 5 },
        { at: 0.35, score: 2 },
        { at: 0.6, score: 0 },
      ])
  const parts = [
    part("roc", "Return on capital", 0.18, roc, metrics.roic == null ? "—" : `${plainPct(metrics.roic, 0)} approximate return on capital`,
      metrics.roic == null
        ? "Operating income or the capital base is missing."
        : metrics.roic >= 0.15
          ? "After-tax operating income over equity plus debt minus cash. He wants a business that earns a lot on the capital it uses. This clears."
          : "After-tax operating income over equity plus debt minus cash. A low return means the business itself is the problem, and a cheap price rarely fixes that for him."),
    part("margin", "Pricing power", 0.12, margin, metrics.grossMargin == null ? "—" : `${plainPct(metrics.grossMargin, 0)} gross margin`,
      "Gross margin is the stand-in for pricing power. It is not a moat. It is the number a moat would leave behind."),
    part("stability", "Margin stability", 0.08, stability, metrics.grossMarginCv == null ? "—" : `${ratio(metrics.grossMarginCv)} variation`,
      metrics.grossMarginCv == null
        ? "Fewer than four years of gross margin, so stability is not scored."
        : "He distrusted a good year that could not be repeated. Low variation is the quiet part of a good business."),
    part("record", "Earnings that keep showing up", 0.1, earningsRecord(metrics),
      metrics.earningsYears ? `${metrics.positiveEarningsYears} of ${metrics.earningsYears} years profitable` : "—",
      "Inversion starts with the years the business lost money. A clean record is not genius. It is the absence of a blow-up."),
    part("debt", "Inversion: debt", 0.12, debtScore(metrics),
      metrics.debtToEquity == null ? "—" : `${ratio(metrics.debtToEquity)} debt / equity`,
      metrics.debt == null
        ? "Interest-bearing debt was not in the annual facts."
        : "Ask what kills the investment. Too often it is the debt, not the product. He wanted a balance sheet that could survive a bad stretch."),
    part("dilution", "Inversion: dilution", 0.08, dilutionScore(metrics),
      metrics.shareChange5y == null ? "—" : `${plainPct(metrics.shareChange5y, 0)} share count over five years`,
      metrics.shareChange5y == null
        ? "Not enough share-count history."
        : metrics.shareChange5y < 0
          ? "The share count fell. Owners were not diluted. That is the capital-allocation part he actually liked."
          : "More shares means each owner was cut in. He treated dilution as a confession."),
    part("shrink", "Inversion: a shrinking business", 0.08, shrinkScore(metrics),
      metrics.revenueChange3y == null ? "—" : `${plainPct(metrics.revenueChange3y, 0)} revenue versus three years ago`,
      metrics.revenueChange3y != null && metrics.revenueChange3y < -0.05
        ? "A cheap price on a business that is getting smaller is the cigar butt he spent the second half of his life refusing."
        : "Revenue is not shrinking. This particular inversion does not bite."),
    part("price", "Price versus quality", 0.24, pricePart.score,
      metrics.fcfYield == null ? "—" : `${plainPct(metrics.fcfYield, 1)} free-cash-flow yield`,
      pricePart.note),
  ]
  return finish("munger", "Charlie Munger", "Quality at a fair price. Invert, always.", metrics, parts)
}

function scoreBuffett(metrics: Metrics): InvestorScore {
  const roe = metrics.roeAvg == null
    ? null
    : scale(metrics.roeAvg, [
        { at: 0, score: 0 },
        { at: 0.08, score: 3 },
        { at: 0.15, score: 7 },
        { at: 0.2, score: 9 },
        { at: 0.3, score: 10 },
      ])
  const moat = metrics.grossMargin == null
    ? null
    : scale(metrics.grossMargin, [
        { at: 0.15, score: 2 },
        { at: 0.3, score: 5 },
        { at: 0.45, score: 8 },
        { at: 0.6, score: 10 },
      ])
  let priceScore: number | null = null
  let priceNote = "Owner earnings or the share price is missing."
  if (metrics.fcfYield != null) {
    priceScore = scale(metrics.fcfYield, [
      { at: 0.015, score: 1 },
      { at: 0.03, score: 3.5 },
      { at: 0.045, score: 6 },
      { at: 0.06, score: 8 },
      { at: 0.08, score: 10 },
    ])
    if ((metrics.roeAvg ?? 0) >= 0.15 && metrics.fcfYield >= 0.03) priceScore += 0.8
    priceNote = metrics.fcfYield < 0.04
      ? "Owner earnings here are free cash flow, a practical stand-in. He will pay a fair price for a wonderful business. This yield says the price is doing more work than the business."
      : "Owner earnings here are free cash flow. The yield leaves room for the business to do the compounding, which is the part he wants to own."
  }
  const conversion = metrics.fcf == null || metrics.netIncome == null || metrics.netIncome === 0
    ? null
    : scale(metrics.fcf / Math.abs(metrics.netIncome), [
        { at: 0.2, score: 1 },
        { at: 0.6, score: 4 },
        { at: 0.9, score: 7 },
        { at: 1.2, score: 9 },
        { at: 1.6, score: 10 },
      ])
  const parts = [
    part("roe", "Return on equity", 0.2, roe,
      metrics.roeAvg == null
        ? metrics.roe != null && metrics.roe > 1 ? "Book is below one year of earnings" : "—"
        : `${plainPct(metrics.roeAvg, 0)} average, recent years`,
      metrics.roe != null && metrics.roe > 1
        ? `Latest year is ${plainPct(metrics.roe, 0)} only because earnings exceed the equity. The book was paid down. Years like that are left out of the average.`
        : metrics.roe != null && metrics.roe > 0.4
          ? `Latest year is ${plainPct(metrics.roe, 0)}. A very high ROE often means equity was paid out, not that the business suddenly got twice as good. The average is the fairer reading.`
          : "He looked for a business that could keep earning a high return on the equity left inside it."),
    part("moat", "Gross margin, as a moat trace", 0.16, moat,
      metrics.grossMargin == null ? "—" : `${plainPct(metrics.grossMargin, 0)} gross margin`,
      "A durable advantage usually shows up as a margin the customer cannot bargain away. This is a trace, not proof of a franchise."),
    part("debt", "Conservative financing", 0.12, debtScore(metrics),
      metrics.debtToEquity == null ? "—" : `${ratio(metrics.debtToEquity)} debt / equity`,
      "He prefers a company that does not need a kind credit market to stay in business."),
    part("cash", "Earnings that become cash", 0.12, conversion,
      metrics.fcf == null || metrics.netIncome == null ? "—" : `${ratio(metrics.netIncome ? metrics.fcf / metrics.netIncome : null)} cash flow / earnings`,
      "Accounting earnings that never arrive as cash are not owner earnings."),
    part("price", "A fair price", 0.2, priceScore,
      metrics.fcfYield == null ? "—" : `${plainPct(metrics.fcfYield, 1)} owner-earnings yield`,
      priceNote),
    part("dilution", "Share count", 0.1, dilutionScore(metrics),
      metrics.shareChange5y == null ? "—" : `${plainPct(metrics.shareChange5y, 0)} over five years`,
      "Buybacks at a sensible price raise the owner's claim. Issuing shares does the opposite."),
    part("shrink", "The business is still there", 0.1, shrinkScore(metrics),
      metrics.revenueChange3y == null ? "—" : `${plainPct(metrics.revenueChange3y, 0)} revenue versus three years ago`,
      "He wants a business he can still recognize in ten years. A shrinking top line is a reason to doubt that."),
  ]
  return finish("buffett", "Warren Buffett", "A wonderful business at a fair price.", metrics, parts)
}

function scoreGraham(metrics: Metrics): InvestorScore {
  const pe = metrics.eps != null && metrics.eps <= 0
    ? 0
    : metrics.pe == null
      ? null
      : scale(metrics.pe, [
          { at: 8, score: 10 },
          { at: 12, score: 8 },
          { at: 15, score: 6.5 },
          { at: 20, score: 4 },
          { at: 30, score: 1.5 },
          { at: 45, score: 0 },
        ])
  const pb = metrics.equity != null && metrics.equity <= 0
    ? 0
    : metrics.pb == null
      ? null
      : scale(metrics.pb, [
          { at: 0.6, score: 10 },
          { at: 1, score: 8 },
          { at: 1.5, score: 6 },
          { at: 3, score: 3 },
          { at: 8, score: 1 },
          { at: 20, score: 0 },
        ])
  const product = metrics.pe != null && metrics.pb != null ? metrics.pe * metrics.pb : null
  const productScore = product == null
    ? null
    : scale(product, [
        { at: 12, score: 10 },
        { at: 22.5, score: 7 },
        { at: 40, score: 3 },
        { at: 80, score: 0 },
      ])
  const current = metrics.currentRatio == null
    ? null
    : scale(metrics.currentRatio, [
        { at: 0.7, score: 0 },
        { at: 1, score: 2 },
        { at: 1.5, score: 5 },
        { at: 2, score: 8 },
        { at: 3, score: 10 },
      ])
  let coverScore: number | null = null
  let coverReading = "—"
  if (metrics.workingCapital != null && metrics.debt != null) {
    if (metrics.debt === 0) coverScore = 10
    else if (metrics.workingCapital <= 0) coverScore = 1
    else coverScore = scale(metrics.workingCapital / metrics.debt, [
      { at: 0, score: 1 },
      { at: 0.5, score: 3 },
      { at: 1, score: 7 },
      { at: 2, score: 10 },
    ])
    coverReading = `${money(metrics.workingCapital)} working capital against ${money(metrics.debt)} debt`
  }
  const dividend = metrics.dividendYield == null ? null : metrics.dividendYield > 0 ? 8 : 3
  const parts = [
    part("pe", "Earnings multiple", 0.2, pe,
      metrics.eps != null && metrics.eps <= 0 ? "Losses" : metrics.pe == null ? "—" : `${ratio(metrics.pe, 1)}× earnings`,
      metrics.eps != null && metrics.eps <= 0
        ? "The latest year lost money. His multiple has nothing honest to divide."
        : "He wanted roughly 15 times earnings or less. Above that, the margin of safety has to come from somewhere else, and it usually doesn't."),
    part("pb", "Price to book", 0.18, pb,
      metrics.equity != null && metrics.equity <= 0 ? "Negative equity" : metrics.pb == null ? "—" : `${ratio(metrics.pb, 1)}× book`,
      "Book value is accounting equity, not liquidation value. He still used it as the coarse test of cheapness."),
    part("product", "Earnings multiple × book multiple", 0.12, productScore,
      product == null ? "—" : ratio(product, 0),
      "His combined test was 22.5. It stops a stock that is cheap on one measure and absurd on the other."),
    part("current", "Current ratio", 0.14, current,
      metrics.currentRatio == null ? "—" : ratio(metrics.currentRatio),
      "He wanted current assets to cover current liabilities twice. One-to-one is a business that needs next quarter to go well."),
    part("cover", "Debt versus working capital", 0.14, coverScore, coverReading,
      "Long-term debt should sit inside net working capital. If it doesn't, the cheap price is borrowing its courage."),
    part("record", "Years of profit", 0.14, earningsRecord(metrics),
      metrics.earningsYears ? `${metrics.positiveEarningsYears} of ${metrics.earningsYears} years` : "—",
      "A long run of profits was his filter against a single lucky year."),
    part("dividend", "A dividend was paid", 0.08, dividend,
      metrics.dividendYield == null ? "—" : metrics.dividendYield > 0 ? `${plainPct(metrics.dividendYield, 1)} yield` : "None",
      "He liked a dividend as evidence the profits were real enough to mail. A missing dividend is a mark against, not a verdict."),
  ]
  return finish("graham", "Benjamin Graham", "Statistical cheapness and a margin of safety.", metrics, parts)
}

function scoreKlarman(metrics: Metrics): InvestorScore {
  const book = metrics.equity != null && metrics.equity <= 0
    ? 0
    : metrics.pb == null
      ? null
      : scale(metrics.pb, [
          { at: 0.5, score: 10 },
          { at: 0.8, score: 8 },
          { at: 1, score: 6 },
          { at: 1.5, score: 3 },
          { at: 3, score: 1 },
          { at: 6, score: 0 },
        ])
  let ncavScore: number | null = null
  let ncavReading = "—"
  let ncavNote = "Current assets or total liabilities were not in the filing."
  if (metrics.ncavPerShare != null && metrics.price != null) {
    ncavReading = `${price(metrics.ncavPerShare, metrics.currency)} net current assets per share`
    if (metrics.ncavPerShare <= 0) {
      ncavScore = 2
      ncavNote = "Current assets do not cover all liabilities. There is no net-net cushion. This is accounting book, not a liquidation."
    } else {
      const ratioToPrice = metrics.price / metrics.ncavPerShare
      ncavScore = scale(ratioToPrice, [
        { at: 0.67, score: 10 },
        { at: 1, score: 7 },
        { at: 1.5, score: 3 },
        { at: 3, score: 0 },
      ])
      ncavNote = ratioToPrice < 1
        ? "The price sits under net current asset value. That is the hard downside he organized his firm around."
        : "Net current assets are positive, and the price is above them. Useful context, not a bargain by itself."
    }
  }
  const netCash = metrics.cash != null && metrics.debt != null ? metrics.cash - metrics.debt : null
  const cashScore = netCash == null || metrics.marketCap == null
    ? null
    : scale(netCash / metrics.marketCap, [
        { at: -0.4, score: 1 },
        { at: -0.1, score: 4 },
        { at: 0.05, score: 7 },
        { at: 0.2, score: 10 },
      ])
  const melting = metrics.revenueChange3y == null
    ? null
    : scale(metrics.revenueChange3y, [
        { at: -0.35, score: 0 },
        { at: -0.1, score: 3 },
        { at: 0, score: 6 },
        { at: 0.08, score: 8 },
      ])
  let catalystScore: number | null = 1
  let catalystReading = "No catalyst in recent filings"
  let catalystNote = "A discount with nothing to close it is how a cheap stock stays cheap. Nothing in the last few months of filings looks like a push."
  const marginTurn = metrics.currentOperatingMargin != null && metrics.priorOperatingMargin != null
    && metrics.normalOperatingMargin != null
    && metrics.currentOperatingMargin < metrics.normalOperatingMargin
    && metrics.currentOperatingMargin > metrics.priorOperatingMargin
  if (!metrics.filingsLoaded) {
    catalystScore = null
    catalystReading = "—"
    catalystNote = "The recent filing list didn't load, so a catalyst can't be scored."
  } else if (metrics.schedule13d) {
    catalystScore = 9
    catalystReading = "Schedule 13D in the last six months"
    catalystNote = "Someone crossed into a 13D. That is a disclosed, interested holder, which is as close as the filing feed gets to a catalyst."
  } else if (marginTurn) {
    catalystScore = 7
    catalystReading = "Operating margin turned up, still below its own history"
    catalystNote = "The margin is depressed and the latest year is better than the one before. That is a possible inflection, not a promise."
  } else if (metrics.insiderForms > 0) {
    catalystScore = 4
    catalystReading = `${metrics.insiderForms} Form 4${metrics.insiderForms === 1 ? "" : "s"} in the last four months`
    catalystNote = "Insiders filed. The submissions index does not say whether they bought or sold, so this gets partial credit only."
  }
  let safetyScore: number | null = null
  let safetyReading = "—"
  let safetyNote = "Graham's number needs positive earnings and positive book."
  if (metrics.grahamNumber != null && metrics.price != null) {
    const discount = 1 - metrics.price / metrics.grahamNumber
    safetyScore = scale(discount, [
      { at: -1, score: 0 },
      { at: -0.25, score: 2 },
      { at: 0, score: 5 },
      { at: 0.33, score: 8 },
      { at: 0.5, score: 10 },
    ])
    safetyReading = `${price(metrics.grahamNumber, metrics.currency)} Graham number versus ${price(metrics.price, metrics.currency)}`
    safetyNote = discount > 0
      ? "Price is under the Graham number, which is his rough ceiling for what earnings and book can support."
      : "Price is through the Graham number. Any safety here is not statistical."
  }
  const parts = [
    part("book", "Discount to book", 0.22, book,
      metrics.pb == null ? "—" : `${ratio(metrics.pb, 1)}× accounting book`,
      "He buys downside first. Accounting equity is a coarse floor, and it is not cash you can pick up."),
    part("ncav", "Net current assets", 0.12, ncavScore, ncavReading, ncavNote),
    part("cash", "Cash against the price", 0.14, cashScore,
      netCash == null ? "—" : `${money(netCash)} net cash`,
      "Net cash is cash and short-term investments minus debt. A pile of it is staying power. A hole is the thing that forces a sale."),
    part("melt", "Not a melting ice cube", 0.18, melting,
      metrics.revenueChange3y == null ? "—" : `${plainPct(metrics.revenueChange3y, 0)} revenue versus three years ago`,
      metrics.revenueChange3y != null && metrics.revenueChange3y < -0.05
        ? "Cheap and still shrinking is the value trap. He would rather miss it than own the decline."
        : "Revenue is not in a multi-year decline, so this is not the melting-ice-cube failure."),
    part("catalyst", "A reason the gap closes", 0.18, catalystScore, catalystReading, catalystNote),
    part("safety", "Room under a conservative value", 0.16, safetyScore, safetyReading, safetyNote),
  ]
  return finish("klarman", "Seth Klarman", "Downside first, then a catalyst.", metrics, parts)
}

function scoreSchloss(metrics: Metrics): InvestorScore {
  const pb = metrics.equity != null && metrics.equity <= 0
    ? 0
    : metrics.pb == null
      ? null
      : scale(metrics.pb, [
          { at: 0.5, score: 10 },
          { at: 0.8, score: 8.5 },
          { at: 1, score: 7 },
          { at: 1.5, score: 4 },
          { at: 3, score: 1.5 },
          { at: 8, score: 0 },
        ])
  const profit = metrics.netIncome == null ? null : metrics.netIncome > 0 ? 8 : 2
  const current = metrics.currentRatio == null
    ? null
    : scale(metrics.currentRatio, [
        { at: 0.8, score: 1 },
        { at: 1.2, score: 4 },
        { at: 1.8, score: 7 },
        { at: 2.5, score: 10 },
      ])
  const asset = metrics.pb == null
    ? null
    : metrics.ncavPerShare != null && metrics.price != null && metrics.ncavPerShare > metrics.price
      ? 10
      : scale(metrics.pb, [
          { at: 0.7, score: 9 },
          { at: 1.2, score: 6 },
          { at: 2, score: 3 },
          { at: 4, score: 0 },
        ])
  const parts = [
    part("pb", "Cheap versus book", 0.34, pb,
      metrics.pb == null ? "—" : `${ratio(metrics.pb, 1)}× book`,
      "He bought baskets of stocks selling under asset value. Quality was secondary. Price to book is the whole idea."),
    part("debt", "Low debt", 0.22, debtScore(metrics),
      metrics.debtToEquity == null ? "—" : `${ratio(metrics.debtToEquity)} debt / equity`,
      "Cheap plus leveraged is how a basket loses a name for good. He avoided that."),
    part("profit", "It still earns something", 0.16, profit,
      metrics.netIncome == null ? "—" : metrics.netIncome > 0 ? `${money(metrics.netIncome)} of earnings` : "Lost money",
      "He did not need a great business. He did prefer one that was not visibly breaking."),
    part("current", "Working capital", 0.14, current,
      metrics.currentRatio == null ? "—" : `${ratio(metrics.currentRatio)} current ratio`,
      "A current ratio with room in it meant the assets were not all stuck in the plant."),
    part("assets", "Assets behind the price", 0.14, asset,
      metrics.ncavPerShare != null && metrics.price != null && metrics.ncavPerShare > metrics.price
        ? `${price(metrics.ncavPerShare, metrics.currency)} net current assets per share`
        : metrics.pb == null ? "—" : `${ratio(metrics.pb, 1)}× book`,
      "Insider ownership is not in this feed, so it is not scored. He cared about it. The filing here can only show the assets."),
  ]
  return finish("schloss", "Walter Schloss", "A basket of cheap assets and low debt.", metrics, parts)
}

function scoreGreenblatt(metrics: Metrics): InvestorScore {
  let yieldScore: number | null = null
  let yieldReading = "—"
  let yieldNote = "Operating income or enterprise value is missing."
  if (metrics.operatingIncome != null && metrics.operatingIncome <= 0) {
    yieldScore = 0
    yieldReading = "Operating loss"
    yieldNote = "Earnings yield needs operating income. A loss scores as a fail, not as a missing line."
  } else if (metrics.enterpriseValue != null && metrics.enterpriseValue <= 0 && (metrics.operatingIncome ?? 0) > 0) {
    yieldScore = 10
    yieldReading = "More net cash than the equity value"
    yieldNote = "Enterprise value is at or below zero and the business still operates at a profit. The formula treats that as an extreme earnings yield."
  } else if (metrics.earningsYield != null) {
    yieldScore = scale(metrics.earningsYield, [
      { at: 0, score: 0 },
      { at: 0.05, score: 3 },
      { at: 0.08, score: 5 },
      { at: 0.1, score: 7 },
      { at: 0.15, score: 9 },
      { at: 0.2, score: 10 },
    ])
    yieldReading = `${plainPct(metrics.earningsYield, 1)} EBIT / enterprise value`
    yieldNote = "Earnings yield is operating income divided by equity value plus debt minus cash. High means you are paying little for the earnings."
  }
  const roc = metrics.roic == null
    ? null
    : scale(metrics.roic, [
        { at: 0, score: 0 },
        { at: 0.08, score: 3 },
        { at: 0.15, score: 6 },
        { at: 0.25, score: 8.5 },
        { at: 0.4, score: 10 },
      ])
  const parts = [
    part("yield", "Earnings yield", 0.5, yieldScore, yieldReading, yieldNote),
    part("roc", "Return on capital", 0.5, roc,
      metrics.roic == null ? "—" : `${plainPct(metrics.roic, 0)} approximate return on capital`,
      "Return on capital is after-tax operating income over equity plus debt minus cash. He wants both a cheap price and a business that earns a lot on what it uses."),
  ]
  let extra: string | undefined
  if (metrics.priced && yieldScore != null && roc != null) {
    const high = (score: number | null) => score != null && score >= 7
    const low = (score: number | null) => score != null && score <= 4
    if ((high(yieldScore) && low(roc)) || (high(roc) && low(yieldScore))) extra = "Only one side works"
  }
  return finish("greenblatt", "Joel Greenblatt", "High earnings yield and high return on capital.", metrics, parts, extra)
}

const BOOK_PARTS: Record<string, string[]> = {
  munger: ["roc", "margin", "stability", "debt", "price"],
  buffett: ["moat", "debt", "cash", "price"],
  graham: ["current", "cover"],
  klarman: ["ncav", "cash", "safety"],
  schloss: ["debt", "current"],
  greenblatt: ["yield", "roc"],
}

const TRUST_PARTS: Record<string, string[]> = {
  munger: ["price"],
  buffett: ["cash", "price"],
  greenblatt: ["yield", "roc"],
}

function refusedNote(sector: SectorId, investorId: string, partId: string): string {
  if (sector === "reit") {
    return "Not scored. Free cash flow subtracts depreciation a property trust takes on purpose, and operating income is after that charge. This yield is the wrong price."
  }
  if (partId === "debt") {
    return sector === "bank"
      ? "Not scored. Borrowings over equity leave out the deposits, which are how a bank is funded. A low number here is the costume."
      : "Not scored. Borrowings over equity are not the insurer's leverage. The reserves and the investment book are not in this ratio."
  }
  if (partId === "margin" || partId === "stability" || partId === "moat") {
    return "Not scored. Gross margin is a product company's pricing power. This statement does not have that line in the sense the test uses."
  }
  if (partId === "ncav" || partId === "current" || partId === "cover" || partId === "safety") {
    return sector === "bank"
      ? "Not scored. Working capital and the Graham number are tests for an industrial company. They do not describe a loan book."
      : "Not scored. Working capital and the Graham number do not describe an insurance book."
  }
  if (investorId === "klarman" && partId === "cash") {
    return sector === "bank"
      ? "Not scored. Cash minus borrowings ignores the deposits. It is not a pile of spare cash."
      : "Not scored. Cash minus borrowings is not spare cash at an insurer. The reserves sit outside that sum."
  }
  if (partId === "roc" || partId === "yield") {
    return `Not scored. Return on capital here is operating income over equity plus debt minus cash. That is not the capital of ${sector === "bank" ? "a bank" : "an insurer"}. The price that fits is book.`
  }
  return sector === "bank"
    ? "Not scored. Cash from operations is not owner earnings for a bank. The price that fits this statement is book."
    : "Not scored. Cash from operations is not owner earnings for an insurer. The price that fits this statement is book."
}

function censor(investor: InvestorScore, metrics: Metrics, sector: SectorId): InvestorScore {
  const ids = sector === "bank" || sector === "insurer"
    ? BOOK_PARTS[investor.id] ?? []
    : sector === "reit"
      ? TRUST_PARTS[investor.id] ?? []
      : []
  if (!ids.length) return investor
  const parts = investor.parts.map((item) => ids.includes(item.id)
    ? { ...item, score: null, reading: "—", note: refusedNote(sector, investor.id, item.id) }
    : item)
  const next = finish(investor.id, investor.name, investor.era, metrics, parts)
  if (next.score != null) return next
  const note = refusedNote(sector, investor.id, ids[0] ?? "")
  return {
    ...next,
    verdict: "Not this statement",
    summary: note,
    deciding: "The parts that would have used the wrong statement were left blank.",
  }
}

export function scoreAll(metrics: Metrics, sector: SectorId = "operating"): InvestorScore[] {
  return [
    scoreMunger(metrics),
    scoreBuffett(metrics),
    scoreGraham(metrics),
    scoreKlarman(metrics),
    scoreSchloss(metrics),
    scoreGreenblatt(metrics),
  ].map((investor) => censor(investor, metrics, sector))
}

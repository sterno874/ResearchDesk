import { addMonths, money, plainPct, price, ratio } from "./format"
import { developing, skipsMultiple } from "./sector"
import { clamp } from "./stats"
import type { InvestorScore, Memo, Metrics, SectorId, Stage, Target, Trap } from "./types"

function perShare(total: number | null, shares: number | null): number | null {
  if (total == null || !shares || shares <= 0) return null
  return total / shares
}

function earningsPower(revenue: number, margin: number): number {
  return revenue * margin * 0.79
}

/** Multiple for recovered earnings. The trough return should not set the exit price. */
function recoveredMultiple(normalMargin: number | null, debtToEquity: number | null): number {
  const margin = normalMargin ?? 0
  const levered = (debtToEquity ?? 0) > 1.5
  let multiple = 8
  if (margin >= 0.22 && !levered) multiple = 14
  else if (margin >= 0.14 && !levered) multiple = 12
  else if (margin >= 0.08) multiple = 10
  if ((debtToEquity ?? 0) > 2.5) multiple = Math.min(multiple, 8)
  return multiple
}

function qualityMultiple(metrics: Metrics): number {
  const roic = metrics.roic ?? 0
  const gross = metrics.grossMargin
  const grossClears = (floor: number) => gross == null || gross >= floor
  const levered = metrics.debtToEquity != null && metrics.debtToEquity > 1.5
  let multiple = 9
  if (roic >= 0.2 && grossClears(0.35) && !levered) multiple = 17
  else if (roic >= 0.15 && grossClears(0.22) && !levered) multiple = 14
  else if (roic >= 0.1) multiple = 11
  if (levered) multiple = Math.min(multiple, 10)
  return multiple
}

function lowerPositive(a: number | null, b: number | null): number | null {
  const values = [a, b].filter((value): value is number => value != null && value > 0)
  if (!values.length) return a != null && a > 0 ? a : b != null && b > 0 ? b : null
  return Math.min(...values)
}

/** Book can pull a bear case down. It cannot become the bear by sitting above the recovery price. */
function bearBelow(earnings: number | null, asset: number | null, base: number | null): number | null {
  const picked = lowerPositive(earnings, asset)
  if (picked != null && (base == null || picked <= base)) return picked
  if (earnings != null && earnings > 0 && (base == null || earnings <= base)) return earnings
  return null
}

function assumptions(specific: string[]): string[] {
  return [
    ...specific,
    "Tax is assumed at 21% when operating income is turned into earnings. The company's own rate may differ.",
    "The multiple comes from return on capital, gross margin, and debt. It is not the multiple the stock has traded at.",
    "Figures are the latest annual XBRL facts, set next to today's price. A quarter that just happened may not be in the annual line yet.",
  ]
}

function pathKind(metrics: Metrics): Memo["kind"] {
  const current = metrics.currentOperatingMargin
  const normal = metrics.normalOperatingMargin
  const depressed = current != null && normal != null && normal > 0.03 && normal - current >= 0.03 && current < normal * 0.72
  if (depressed) return "turnaround"
  const healthy = (metrics.roic ?? 0) > 0.12 && (metrics.fcf ?? 0) > 0 && (metrics.revenueChange3y == null || metrics.revenueChange3y > -0.08)
  if (healthy) return "compounder"
  return "unclear"
}

function turnaround(metrics: Metrics): Memo {
  const multiple = recoveredMultiple(metrics.normalOperatingMargin, metrics.debtToEquity)
  const revenue = metrics.revenue
  const normal = metrics.normalOperatingMargin
  const current = metrics.currentOperatingMargin
  const shares = metrics.shares
  const baseEarn = revenue != null && normal != null && normal > 0 ? earningsPower(revenue, normal) : null
  const base = perShare(baseEarn != null ? baseEarn * multiple : null, shares)
  const bearEarn = revenue != null && current != null && current > 0 ? earningsPower(revenue, current) : null
  const bearFromEarnings = bearEarn != null ? perShare(bearEarn * Math.max(6, multiple - 5), shares) : null
  const asset = metrics.bookPerShare != null && metrics.bookPerShare > 0 ? metrics.bookPerShare * 0.7 : null
  const bear = bearBelow(bearFromEarnings, asset, base)
  const peak = metrics.peakRevenue != null && revenue != null ? Math.max(metrics.peakRevenue, revenue) : revenue
  const bullEarn = peak != null && normal != null && normal > 0 ? earningsPower(peak, normal) : null
  const bull = perShare(bullEarn != null ? bullEarn * (multiple + 3) : null, shares)
  const halfway = current != null && normal != null ? (current + normal) / 2 : null
  const target: Target = {
    bear,
    base,
    bull,
    fairNow: base,
    deep: null,
    deepNote: "",
    method: "Base case restores the company's own older operating margin on today's revenue, then applies a conservative multiple. Revenue is not assumed to recover except in the bull case.",
    assumptions: assumptions([
      `Normal operating margin is the median of earlier years, ${plainPct(normal, 1)}. The latest year is ${plainPct(current, 1)}.`,
      `The base multiple is ${multiple}× after-tax earnings power. The bear case keeps today's margin if it is positive, and uses 70% of book only when that figure is lower. A loss is not assigned the book value.`,
    ]),
  }
  const stages: Stage[] = [
    {
      when: "Now",
      title: "The gap",
      detail: `Operating margin is ${plainPct(current, 1)} against ${plainPct(normal, 1)} in earlier years. The base case uses the latest revenue, ${money(revenue)}, with no heroic sales recovery. That earns about ${money(baseEarn)} after tax, and at ${multiple}× it is ${price(base, metrics.currency)} a share.`,
    },
    {
      when: addMonths(9),
      title: "First proof",
      detail: halfway == null
        ? "The next few filings have to show the margin moving back toward its own history. If it keeps falling, this is a decline with a cheap-looking multiple, not a turnaround."
        : `The next two or three filings need the margin moving toward ${plainPct(halfway, 1)}, the halfway mark. If it keeps falling, the base case is wrong and the idea is a decline.`,
    },
    {
      when: addMonths(18),
      title: "Earnings power",
      detail: `If the older margin actually returns, earnings power is about ${money(baseEarn)}, or ${price(perShare(baseEarn, shares), metrics.currency)} a share. Until a filing shows that run-rate, the price target is a hypothesis.`,
    },
    {
      when: addMonths(30),
      title: "What the price could be",
      detail: `If the market then pays ${multiple}× that earning power, the base price is ${price(base, metrics.currency)}. ${
        bear != null
          ? `The bear case, if the slump stays, is ${price(bear, metrics.currency)}.`
          : current != null && current <= 0 && asset != null && base != null && asset > base
            ? `The latest year lost money, so the slump has no earnings price. Seventy percent of book is ${price(asset, metrics.currency)}, and that sits above the recovery case, so it is not the bear.`
            : current != null && current <= 0
              ? "The latest year lost money, so the slump has no earnings price."
              : "The bear case is not set."
      } ${
        metrics.debtToEquity != null && metrics.debtToEquity > 1
          ? `Debt is ${metrics.debtToEquity.toFixed(1)}× equity, which can eat the wait.`
          : "The balance sheet is not the loudest risk. The risk is that the margin never comes back."
      }`,
    },
  ]
  return {
    kind: "turnaround",
    label: "Turnaround",
    summary: "Margins are below this company's own history by enough to matter. The memo treats that as a turnaround and does not assume sales bounce back.",
    stages,
    target,
  }
}

function compounder(metrics: Metrics): Memo {
  const multiple = qualityMultiple(metrics)
  const growth = clamp(metrics.revenueCagr ?? 0.03, 0, 0.07)
  const earning = metrics.ownerEarnings != null && metrics.ownerEarnings > 0 ? metrics.ownerEarnings : null
  const earningLater = earning != null ? earning * (1 + growth) ** 3 : null
  const fairNow = perShare(earning != null ? earning * multiple : null, metrics.shares)
  const base = perShare(earningLater != null ? earningLater * multiple : null, metrics.shares)
  const bear = perShare(
    earning != null ? earning * (1 + growth * 0.25) ** 3 * Math.max(6, multiple - 4) : null,
    metrics.shares,
  )
  const bull = perShare(
    earning != null ? earning * (1 + Math.min(growth + 0.02, 0.09)) ** 3 * (multiple + 3) : null,
    metrics.shares,
  )
  const dividend = metrics.dividendYield != null && metrics.dividendYield > 0.005
    ? ` The dividend yield is about ${plainPct(metrics.dividendYield, 1)} on top of that.`
    : ""
  let held = "The three-year base case needs both the capped growth and the multiple to hold."
  if (base != null && metrics.price != null && metrics.price > 0) {
    const annual = (base / metrics.price) ** (1 / 3) - 1
    held = annual >= 0
      ? `Paying today's price and arriving at the base case in three years is about ${plainPct(annual, 0)} a year, before dividends.`
      : `Paying today's price and arriving at the base case in three years still loses about ${plainPct(Math.abs(annual), 0)} a year. The growth in the filings does not bail out the price.`
  }
  const target: Target = {
    bear,
    base,
    bull,
    fairNow,
    deep: null,
    deepNote: "",
    method: "Owner earnings are free cash flow. They are grown for three years at a capped rate, then valued on a multiple set by the quality of the business. Fair value today is that multiple with no growth credit.",
    assumptions: assumptions([
      `Growth is capped at ${plainPct(growth, 1)} a year, even if the company has grown faster. The cap is the discipline.`,
      `Today's free cash flow is ${money(earning)}. The multiple is ${multiple}×.`,
      `What a buyer might pay today, with no growth credit, is ${price(fairNow, metrics.currency)}.`,
    ]),
  }
  const stages: Stage[] = [
    {
      when: "Now",
      title: "The business is already working",
      detail: `Return on capital is about ${plainPct(metrics.roic, 0)} and free cash flow is ${money(metrics.fcf)}. Nothing here needs to be rescued. The question is what you pay for a business that is already doing this.`,
    },
    {
      when: "Each year",
      title: "Reinvestment, capped",
      detail: `The memo lets owner earnings grow at ${plainPct(growth, 1)} and no faster. A model that needs a faster rate is a different, more optimistic memo.`,
    },
    {
      when: addMonths(36),
      title: "What you underwrote",
      detail: `${held}${dividend} If the multiple compresses, the bear price is ${price(bear, metrics.currency)}.`,
    },
    {
      when: "The risk",
      title: "Paying a full price for a good business",
      detail: `Fair value with no growth credit is ${price(fairNow, metrics.currency)} against a market price of ${price(metrics.price, metrics.currency)}. When those two are far apart, time has to do a lot of work, and Munger's price test is the one that will say so.`,
    },
  ]
  return {
    kind: "compounder",
    label: "Compounder",
    summary: "The filings look like a business that already earns its capital and produces cash. This is a compounding memo, not a rescue.",
    stages,
    target,
  }
}

function unclear(metrics: Metrics): Memo {
  const multiple = Math.min(qualityMultiple(metrics), 10)
  const earning = metrics.ownerEarnings != null && metrics.ownerEarnings > 0 ? metrics.ownerEarnings : null
  const fromCash = perShare(earning != null ? earning * multiple : null, metrics.shares)
  const book = metrics.bookPerShare != null && metrics.bookPerShare > 0 ? metrics.bookPerShare : null
  const base = fromCash ?? book
  const bear = bearBelow(fromCash != null ? fromCash * 0.6 : null, book != null ? book * 0.6 : null, base)
  const bull = fromCash != null ? fromCash * 1.35 : book
  const method = fromCash != null
    ? "There is no clean turnaround and no high-return compounder in the filings. The base number is a cautious multiple on current free cash flow, not a forecast of a better business."
    : "Earnings power is not showing up as cash. The base number is accounting book value per share, which is the equity on the balance sheet and not a price target in the usual sense."
  const target: Target = {
    bear,
    base,
    bull,
    fairNow: base,
    deep: null,
    deepNote: "",
    method,
    assumptions: assumptions([
      fromCash != null
        ? `Free cash flow is ${money(earning)}, and the multiple is held to ${multiple}×.`
        : `Book value is ${price(book, metrics.currency)} a share.`,
    ]),
  }
  const stages: Stage[] = [
    {
      when: "Now",
      title: "What the filing actually shows",
      detail: `Operating margin is ${plainPct(metrics.operatingMargin, 1)}, return on capital is ${plainPct(metrics.roic, 0)}, and free cash flow is ${money(metrics.fcf)}. None of that draws a straight line to a higher price.`,
    },
    {
      when: addMonths(12),
      title: "What would change the memo",
      detail: "A year of margin moving back to this company's own history would make it a turnaround. A stretch of high returns and real free cash flow would make it a compounder. Until one of those shows up, the path is the weak part.",
    },
    {
      when: "Until then",
      title: "No timeline worth pretending",
      detail: `The base figure is ${price(base, metrics.currency)}. Treat it as a reference from the statements, not as a date on which the market owes you that price.`,
    },
    {
      when: "The risk",
      title: "A story with no filing behind it",
      detail: "The dangerous version of this name is a narrative about a future business that the annual numbers do not describe yet.",
    },
  ]
  return {
    kind: "unclear",
    label: "No clear path",
    summary: "The filings do not show a margin collapse waiting to revert, and they do not show a high-return business throwing off cash. There is no timeline here that the numbers earn.",
    stages,
    target,
  }
}

function spendingMissing(metrics: Metrics): boolean {
  return metrics.warnings.some((line) => /capital spending is not in the filing feed/i.test(line))
}

function withheld(label: string, summary: string, detail: string, method?: string): Memo {
  const target: Target = {
    bear: null,
    base: null,
    bull: null,
    fairNow: null,
    deep: null,
    deepNote: "",
    method: method ?? "No free-cash-flow multiple is set. That multiple prices an operating company, and this filing is a different business.",
    assumptions: [
      "The bear, base, and bull prices are withheld on purpose.",
      "Figures are the latest annual XBRL facts, set next to today's price. A quarter that just happened may not be in the annual line yet.",
    ],
  }
  return {
    kind: "unclear",
    label,
    summary,
    stages: [{ when: "The statements", title: "What is actually being read", detail }],
    target,
  }
}

function deepValue(metrics: Metrics, sector: SectorId): { price: number | null; note: string } {
  if (metrics.statementCurrency && metrics.statementCurrency !== metrics.currency) {
    return {
      price: null,
      note: "No deep-value price. The statements and the quote are in different currencies.",
    }
  }
  const book = metrics.bookPerShare != null && metrics.bookPerShare > 0 ? metrics.bookPerShare : null
  const paidDown = metrics.netIncome != null && metrics.equity != null && metrics.equity > 0 && metrics.netIncome > metrics.equity
  if (skipsMultiple(sector)) {
    return book == null
      ? { price: null, note: "Deep value for this statement is book value per share. Book was not available." }
      : { price: book, note: "Deep value here is book value per share. An earnings multiple is not used on this statement." }
  }
  if (metrics.grahamNumber != null && metrics.grahamNumber > 0) {
    return {
      price: metrics.grahamNumber * (2 / 3),
      note: "Deep value is two-thirds of the Graham number. That is a third under the price where earnings and book pass his 22.5 test. It is not the base-case multiple.",
    }
  }
  if (book != null && !paidDown) {
    return { price: book, note: "There is no Graham number. Deep value falls back to book value per share." }
  }
  return {
    price: null,
    note: paidDown
      ? "Earnings are larger than the equity, so the book has been paid down. A deep-value price is not set from that book, and there is no Graham number."
      : "A deep-value price needs positive earnings and positive book. This filing does not have both.",
  }
}

function stamp(memo: Memo, metrics: Metrics, sector: SectorId): Memo {
  const line = deepValue(metrics, sector)
  return { ...memo, target: { ...memo.target, deep: line.price, deepNote: line.note } }
}

export function buildMemo(metrics: Metrics, sector: SectorId): Memo {
  if (metrics.statementCurrency && metrics.statementCurrency !== metrics.currency) {
    return stamp(withheld(
      "Different currencies",
      `The annual figures are in ${metrics.statementCurrency}. The quote is in ${metrics.currency}. Revenue was ${money(metrics.revenue, metrics.statementCurrency)}.`,
      "A per-share price divides a statement total by the share count and sets it next to the quote. Those two numbers are not the same currency, and the filing feed did not give the exchange rate. The price is withheld.",
      "No per-share price is set. The statements and the quote are in different currencies.",
    ), metrics, sector)
  }
  if (skipsMultiple(sector)) {
    if (sector === "bank") {
      return stamp(withheld(
        "A bank, not a cash-flow multiple",
        `Return on equity is ${plainPct(metrics.roe, 0)} and the price is ${metrics.pb == null ? "unknown" : `${ratio(metrics.pb, 2)}×`} book. Cash from operations is the bank's own statement, not owner earnings.`,
        "The equity value of a bank is book and the return earned on it, through a credit cycle. A free-cash-flow yield here is the costume. Deposits and borrowings are the funding, and they are not a corporate bond stack sitting under an operating profit.",
      ), metrics, sector)
    }
    if (sector === "insurer") {
      return stamp(withheld(
        "An insurer, not a cash-flow multiple",
        `The price is ${metrics.pb == null ? "unknown" : `${ratio(metrics.pb, 2)}×`} book and the return on equity is ${plainPct(metrics.roe, 0)}. Underwriting and the investment book are in that return together.`,
        "An insurer is read against book. This feed does not split underwriting profit from investment income, and it does not turn the statement into free cash flow for a multiple.",
      ), metrics, sector)
    }
    return stamp(withheld(
      "A property trust, not a cash-flow multiple",
      `Revenue is ${money(metrics.revenue)} and the dividend yield is ${plainPct(metrics.dividendYield, 1)}. Free cash flow subtracts depreciation the buildings take on purpose.`,
      "A REIT is rent, debt, and the distribution. Funds from operations are not a tag this desk reads, so no bear, base, or bull price is set from free cash flow.",
    ), metrics, sector)
  }
  if (developing(sector, metrics)) {
    const burn = metrics.fcf != null && metrics.fcf < 0 && metrics.cash != null && metrics.fcf !== 0
      ? ` Cash of ${money(metrics.cash)} against free cash flow of ${money(metrics.fcf)} is about ${(-metrics.cash / metrics.fcf).toFixed(1)} years of that burn.`
      : ""
    return stamp(withheld(
      "Studies and cash, not a multiple",
      `Revenue is ${money(metrics.revenue)}. Profitable years on file: ${metrics.positiveEarningsYears} of ${metrics.earningsYears}.${burn}`,
      "The price of a development-stage drug company is the studies and the cash, then the shares that get issued to keep the studies going. An earnings multiple waits until a product has a sales record. The open studies, when the register has them, are in the sector section.",
    ), metrics, sector)
  }
  if (spendingMissing(metrics)) {
    return stamp(withheld(
      "Capital spending was not filed",
      `Cash from operations was ${money(metrics.cfo)}. The filing feed has no capital-spending line for that year, so free cash flow is left blank.`,
      "Free cash flow is cash from operations minus capital spending. A missing spending line is not a year with no spending. No bear, base, or bull price is set from that cash.",
      "No free-cash-flow price is set. Capital spending was not in the filing feed.",
    ), metrics, sector)
  }
  const kind = pathKind(metrics)
  if (kind === "turnaround") return stamp(turnaround(metrics), metrics, sector)
  if (kind === "compounder") return stamp(compounder(metrics), metrics, sector)
  return stamp(unclear(metrics), metrics, sector)
}

export function buildPitch(metrics: Metrics, memo: Memo, traps: Trap[], sector: SectorId): string {
  const warning = traps.find((trap) => trap.memoLine && (trap.severity === "wall" || trap.severity === "serious"))?.memoLine ?? ""
  const books = metrics.statementCurrency ?? metrics.currency
  const worth = metrics.marketCap != null ? ` The equity is worth ${money(metrics.marketCap, metrics.currency)}.` : ""
  const scale = skipsMultiple(sector)
    ? `Equity is ${money(metrics.equity, books)}.${worth}`
    : developing(sector, metrics)
      ? `Revenue was ${money(metrics.revenue, books)}. Cash is ${money(metrics.cash, books)}.${worth}`
      : `Revenue was ${money(metrics.revenue, books)}. Free cash flow was ${money(metrics.fcf, books)}.${worth}`
  const wall = traps.some((trap) => trap.id === "maturity-wall")
  let play: string
  if (wall) {
    play = "The play is the debt coming due, not a cheap stock sitting under a pile of profit. The equity is a stub on that refinance."
  } else if (memo.kind === "turnaround") {
    play = `The play is a turnaround. Operating margin is ${plainPct(metrics.currentOperatingMargin, 1)} against ${plainPct(metrics.normalOperatingMargin, 1)} in this company's own earlier years. The case uses today's revenue and does not assume the old sales come back.`
  } else if (sector === "staple" && memo.kind === "compounder") {
    const fair = memo.target.fairNow
    const priced = metrics.price != null && fair != null
      ? ` A no-growth value on today's free cash flow is ${price(fair, metrics.currency)} a share, against ${price(metrics.price, metrics.currency)} in the market.`
      : ""
    play = `This is a consumer staple that already earns its keep. The record that matters is a gross margin that sits still and a dividend that kept being paid.${priced}`
  } else if (sector === "software" && memo.kind === "compounder") {
    play = `This files as software. The gross margin is ${plainPct(metrics.grossMargin, 0)}, which is the split between a product and a services shop. Return on capital is about ${plainPct(metrics.roic, 0)}.`
  } else if (memo.kind === "compounder" && traps.some((trap) => trap.id === "fresh-listing")) {
    play = `The filings show a business that earned its capital last year. Return on capital is about ${plainPct(metrics.roic, 0)}. The quote is not a long market for that year.`
  } else if (memo.kind === "compounder") {
    const fair = memo.target.fairNow
    const priced = metrics.price != null && fair != null
      ? ` A no-growth value on today's free cash flow is ${price(fair, metrics.currency)} a share, against ${price(metrics.price, metrics.currency)} in the market.`
      : fair != null
        ? ` A no-growth value on today's free cash flow is ${price(fair, metrics.currency)} a share.`
        : ""
    play = `The play is a business that already works. Return on capital is about ${plainPct(metrics.roic, 0)}. Nothing in the filings has to be rescued.${priced}`
  } else if (
    (metrics.statementCurrency != null && metrics.statementCurrency !== metrics.currency)
    || skipsMultiple(sector)
    || developing(sector, metrics)
    || spendingMissing(metrics)
  ) {
    play = memo.summary
  } else {
    play = "The play is not a clean one. The filings do not show a margin waiting to revert, and they do not show a high-return business throwing off cash."
  }
  return [play, scale, warning].filter(Boolean).join(" ")
}

export function buildHeadline(investors: InvestorScore[]): string {
  const ranked = investors.filter((investor) => investor.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  if (!ranked.length) {
    return "The filings loaded. The market price did not, so the rubric totals are withheld. The parts that can be read from the statements are still below."
  }
  const top = ranked[0]
  const bottom = ranked[ranked.length - 1]
  if (bottom.id === top.id) return `${top.name} is the closest reader at ${top.score}.`
  return `${top.name} is the closest reader at ${top.score}. ${bottom.name} is the dissent at ${bottom.score}.`
}

import { addMonths, money, plainPct, price } from "./format"
import { clamp } from "./stats"
import type { InvestorScore, Memo, Metrics, Stage, Target, Trap } from "./types"

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
  const bearEarn = revenue != null && current != null && current > 0 ? earningsPower(revenue, current) : 0
  const bearFromEarnings = perShare(bearEarn * Math.max(6, multiple - 5), shares)
  const asset = metrics.bookPerShare != null && metrics.bookPerShare > 0 ? metrics.bookPerShare * 0.7 : null
  const bear = lowerPositive(bearFromEarnings, asset)
  const peak = metrics.peakRevenue != null && revenue != null ? Math.max(metrics.peakRevenue, revenue) : revenue
  const bullEarn = peak != null && normal != null && normal > 0 ? earningsPower(peak, normal) : null
  const bull = perShare(bullEarn != null ? bullEarn * (multiple + 3) : null, shares)
  const halfway = current != null && normal != null ? (current + normal) / 2 : null
  const target: Target = {
    bear,
    base,
    bull,
    fairNow: base,
    method: "Base case restores the company's own older operating margin on today's revenue, then applies a conservative multiple. Revenue is not assumed to recover except in the bull case.",
    assumptions: assumptions([
      `Normal operating margin is the median of earlier years, ${plainPct(normal, 1)}. The latest year is ${plainPct(current, 1)}.`,
      `The base multiple is ${multiple}× after-tax earnings power. The bear case keeps today's margin if it is positive, and also looks at 70% of book.`,
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
      detail: `If the market then pays ${multiple}× that earning power, the base price is ${price(base, metrics.currency)}. The bear case, if the slump stays, is ${price(bear, metrics.currency)}. ${
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
  const bear = book != null ? book * 0.6 : fromCash != null ? fromCash * 0.6 : null
  const bull = fromCash != null ? fromCash * 1.35 : book
  const method = fromCash != null
    ? "There is no clean turnaround and no high-return compounder in the filings. The base number is a cautious multiple on current free cash flow, not a forecast of a better business."
    : "Earnings power is not showing up as cash. The base number is accounting book value per share, which is the equity on the balance sheet and not a price target in the usual sense."
  const target: Target = {
    bear,
    base,
    bull,
    fairNow: base,
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

export function buildMemo(metrics: Metrics): Memo {
  const kind = pathKind(metrics)
  if (kind === "turnaround") return turnaround(metrics)
  if (kind === "compounder") return compounder(metrics)
  return unclear(metrics)
}

export function buildPitch(metrics: Metrics, memo: Memo, traps: Trap[]): string {
  const warning = traps.find((trap) => trap.memoLine && (trap.severity === "wall" || trap.severity === "serious"))?.memoLine ?? ""
  const scale = `Revenue was ${money(metrics.revenue)}. Free cash flow was ${money(metrics.fcf)}.${metrics.marketCap != null ? ` The equity is worth ${money(metrics.marketCap)}.` : ""}`
  const wall = traps.some((trap) => trap.id === "maturity-wall")
  let play: string
  if (wall) {
    play = "The play is the debt coming due, not a cheap stock sitting under a pile of profit. The equity is a stub on that refinance."
  } else if (memo.kind === "turnaround") {
    play = `The play is a turnaround. Operating margin is ${plainPct(metrics.currentOperatingMargin, 1)} against ${plainPct(metrics.normalOperatingMargin, 1)} in this company's own earlier years. The case uses today's revenue and does not assume the old sales come back.`
  } else if (memo.kind === "compounder") {
    const fair = memo.target.fairNow
    const priced = metrics.price != null && fair != null
      ? ` A no-growth value on today's free cash flow is ${price(fair, metrics.currency)} a share, against ${price(metrics.price, metrics.currency)} in the market.`
      : fair != null
        ? ` A no-growth value on today's free cash flow is ${price(fair, metrics.currency)} a share.`
        : ""
    play = `The play is a business that already works. Return on capital is about ${plainPct(metrics.roic, 0)}. Nothing in the filings has to be rescued.${priced}`
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

import type { Report, Trap } from "./types"
import { developing, skipsMultiple } from "./sector"

export type HorizonId = "quarters" | "years" | "decade" | "none"

export type BlotterRead = {
  ticker: string
  stars: number | null
  median: number | null
  closest: string | null
  closestScore: number | null
  horizon: HorizonId
  horizonLabel: string
  why: string
  /** How far a deep dive has been taken. Absent until a dive is opened. */
  depth?: number
  /** Set when missing profile facts capped the stars, or when they were already under the cap. */
  fileNote?: string
  readAt: string
}

const HORIZON_LABEL: Record<HorizonId, string> = {
  quarters: "1–2 quarters",
  years: "1–2 years",
  decade: "5–10 years",
  none: "No clock",
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

/** Same bands the rubrics use for a verdict. One star is a poor read, five is a rare one. */
function starsFrom(value: number): number {
  if (value < 36) return 1
  if (value < 52) return 2
  if (value < 68) return 3
  if (value < 80) return 4
  return 5
}

function wallYear(trap: Trap): number | null {
  const years = trap.timeline?.when.match(/\d{4}/g)?.map(Number) ?? []
  return years.length ? years[0] : null
}

/** Facts the profile is supposed to carry. A bad number is not a gap. A missing one is. */
export function statementGaps(report: Report): string[] {
  const gaps: string[] = []
  const metrics = report.metrics
  if (/did not yield a clean business description|was not extracted/i.test(report.company)) gaps.push("a business description")
  if (metrics.revenue == null) gaps.push("revenue")
  if (metrics.operatingIncome == null && metrics.netIncome == null) gaps.push("a profit figure")
  if (metrics.equity == null) gaps.push("the equity")
  if (metrics.cfo == null && metrics.fcf == null) gaps.push("cash flow")
  return gaps
}

function written(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`
}

/** One missing piece stops the stars at 4. Two stop them at 3. Three or more stop them at 2. */
export function capStars(stars: number | null, gaps: string[]): { stars: number | null; fileNote: string } {
  const unique = [...new Set(gaps)]
  if (stars == null || unique.length === 0) return { stars, fileNote: "" }
  const cap = unique.length === 1 ? 4 : unique.length === 2 ? 3 : 2
  const limited = Math.min(stars, cap)
  const missing = written(unique)
  if (limited < stars) {
    return { stars: limited, fileNote: `Missing ${missing}, so the stars stop at ${limited}.` }
  }
  return { stars, fileNote: `Missing ${missing}. The reader median was already at ${stars}.` }
}

export function shorthand(report: Report, now = new Date()): Omit<BlotterRead, "readAt"> {
  const scores = report.investors.map((investor) => investor.score).filter((score): score is number => score != null)
  const mid = median(scores)
  const closest = [...report.investors]
    .filter((investor) => investor.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null
  const rawStars = mid == null ? null : starsFrom(mid)
  const capped = capStars(rawStars, report.gaps ?? statementGaps(report))
  const stars = capped.stars
  const warning = report.traps.find((trap) => trap.severity === "wall" || trap.severity === "serious")

  const wall = report.traps.find((trap) => trap.id === "maturity-wall" && trap.timeline)
  let horizon: HorizonId = "none"
  let clock = "The annual numbers do not show a margin recovering or a high-return business throwing off cash. A quarter or a decade would both be a guess."

  if (wall) {
    const year = wallYear(wall)
    const out = year == null ? 2 : year - now.getFullYear()
    if (out <= 0) {
      horizon = "quarters"
      clock = "The refinance window in the filing is this year. That is a 1–2 quarter clock, and it is a credit question before it is an equity one."
    } else if (out <= 4) {
      horizon = "years"
      clock = `The large principal in the filing comes due around ${year ?? "the wall"}. The equity bet is the refinance window before that, on a 1–2 year clock.`
    } else {
      horizon = "decade"
      clock = `The large principal in the filing is years out${year ? ` (${year})` : ""}. The statements do not make that a one- or two-year equity outcome.`
    }
  } else if (report.traps.some((trap) => trap.id === "fresh-listing")) {
    horizon = "none"
    clock = "The quote is a new listing, and it has already fallen. Closing the gap to last year's cash flow on a one- or two-year clock is a guess."
  } else if (report.metrics.statementCurrency && report.metrics.statementCurrency !== report.metrics.currency) {
    horizon = "none"
    clock = `The statements are in ${report.metrics.statementCurrency} and the quote is in ${report.metrics.currency}. A clock on a price gap is not set from mixed units.`
  } else if (report.memo.kind === "turnaround") {
    horizon = "years"
    clock = "Margins are below this company's own history. The memo looks for proof across the next several filings, and the price case sits about two years out."
  } else if (report.memo.kind === "compounder") {
    const price = report.metrics.price
    const fair = report.memo.target.fairNow
    const cheap = price != null && fair != null && fair > 0 && price < fair * 0.8
    if (cheap) {
      horizon = "years"
      clock = "The price sits under a no-growth value from today's free cash flow. If that gap closes, it is a 1–2 year event. The business itself does not need a rescue."
    } else {
      horizon = "decade"
      clock = "The filings describe a business that already earns its capital. Nothing in them closes in a quarter or two. Owning it is a 5–10 year hold, and time has to earn the price."
    }
  } else if (skipsMultiple(report.sector.id) || developing(report.sector.id, report.metrics)) {
    horizon = "none"
    clock = skipsMultiple(report.sector.id)
      ? "Book and the return on it are the read. A one- or two-year close of a free-cash-flow gap is the wrong clock for this sector."
      : "The clock is the studies and the cash. A multiple catching up to earnings that are not in the statements yet is a guess."
  } else if (report.metrics.warnings.some((line) => /capital spending is not in the filing feed/i.test(line))) {
    horizon = "none"
    clock = "Capital spending is missing from the filing feed, so free cash flow was left blank. A clock on a cash-flow gap is not set from a spending figure the filing did not give."
  }

  const reader = closest && mid != null
    ? `${closest.name} is the closest reader at ${closest.score}. The stars use the median of the six, ${Math.round(mid)}.`
    : "The market price did not load, so the stars are withheld."
  const caution = warning ? ` The filing's own warning is already in that spread: ${warning.title}.` : ""
  const file = capped.fileNote ? ` ${capped.fileNote}` : ""

  return {
    ticker: report.metrics.ticker,
    stars,
    median: mid == null ? null : Math.round(mid),
    closest: closest?.name ?? null,
    closestScore: closest?.score ?? null,
    horizon,
    horizonLabel: HORIZON_LABEL[horizon],
    fileNote: capped.fileNote || undefined,
    why: `${reader}${caution} ${clock}${file}`,
  }
}

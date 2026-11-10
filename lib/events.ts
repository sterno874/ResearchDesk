import type { InsiderMark } from "./insider"
import { count } from "./format"
import type { DeskEvent, Filing, Memo, SectorStudy, Trap } from "./types"

const ITEMS: { test: RegExp; heat: number; label: string }[] = [
  { test: /\b1\.03\b/, heat: 0.98, label: "Bankruptcy" },
  { test: /\b2\.06\b/, heat: 0.9, label: "Impairment" },
  { test: /\b2\.04\b/, heat: 0.82, label: "Debt trigger" },
  { test: /\b2\.01\b/, heat: 0.8, label: "Acquisition" },
  { test: /\b1\.01\b/, heat: 0.7, label: "Material agreement" },
  { test: /\b1\.02\b/, heat: 0.64, label: "Agreement ended" },
  { test: /\b2\.05\b/, heat: 0.6, label: "Exit costs" },
  { test: /\b5\.02\b/, heat: 0.44, label: "Officer change" },
  { test: /\b2\.02\b/, heat: 0.22, label: "Earnings release" },
]

const STOPS: [number, [number, number, number]][] = [
  [0, [18, 48, 122]],
  [0.28, [24, 78, 132]],
  [0.5, [92, 72, 36]],
  [0.72, [140, 48, 28]],
  [1, [110, 16, 22]],
]

/** Dark red at 1, deep blue at 0. The steps in between are the same scale. */
export function heatColor(heat: number): string {
  const h = Math.min(1, Math.max(0, heat))
  let index = 0
  while (index < STOPS.length - 2 && STOPS[index + 1][0] < h) index += 1
  const [left, from] = STOPS[index]
  const [right, to] = STOPS[index + 1]
  const span = right - left
  const mix = span === 0 ? 0 : (h - left) / span
  const rgb = from.map((channel, slot) => Math.round(channel + (to[slot] - channel) * mix))
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** A phase 3 date still ahead, an open refinance window, a recent open-market buy, or a Schedule 13D. */
export function datedMarks(events: DeskEvent[] | undefined, today = iso(new Date())): DeskEvent[] {
  if (!events?.length) return []
  return events.filter((event) => {
    if (event.label === "Phase 3 primary completion") return event.date >= today
    if (event.label === "Refinance window") return (event.until ?? event.date) >= today
    return event.label === "Insider buy" || event.label === "Schedule 13D"
  })
}

export function hasDatedCatalyst(events: DeskEvent[] | undefined, today = iso(new Date())): boolean {
  return datedMarks(events, today).length > 0
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number)
  return iso(new Date(year, month - 1, date + days))
}

function clip(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1).trim()}…`
}

function studyDate(when: string): string | null {
  const full = /^(\d{4})-(\d{2})-(\d{2})/.exec(when)
  if (full) return `${full[1]}-${full[2]}-${full[3]}`
  const month = /^(\d{4})-(\d{2})$/.exec(when)
  if (month) return `${month[1]}-${month[2]}-15`
  return null
}

function trialHeat(phase: string): number {
  if (/phase\s*3/i.test(phase)) return 0.96
  if (/phase\s*2/i.test(phase)) return 0.72
  if (/early|phase\s*1/i.test(phase)) return 0.5
  return 0.4
}

function trialLabel(phase: string): string {
  if (/phase\s*3/i.test(phase)) return "Phase 3 primary completion"
  if (/phase\s*2/i.test(phase)) return "Phase 2 primary completion"
  if (/early|phase\s*1/i.test(phase)) return "Early-trial primary completion"
  return "Trial primary completion"
}

function hottestItem(items: string): { heat: number; label: string } | null {
  let best: { heat: number; label: string } | null = null
  for (const item of ITEMS) {
    if (!item.test.test(items)) continue
    if (!best || item.heat > best.heat) best = { heat: item.heat, label: item.label }
  }
  return best
}

function nextReport(filings: Filing[], today: string, kind: Memo["kind"]): { date: string; latest: string } | null {
  const periodic = filings.filter((filing) => /^(10-Q|10-K|20-F|40-F)\b/.test(filing.form) && /^\d{4}-\d{2}-\d{2}$/.test(filing.date))
  if (!periodic.length) return null
  const latest = periodic.map((filing) => filing.date).sort().at(-1)
  if (!latest) return null
  let date = addDays(latest, 91)
  for (let step = 0; step < 4 && date < today; step++) date = addDays(date, 91)
  if (date < today || date > addDays(today, 200)) return null
  return { date, latest }
}

function refinance(trap: Trap, today: string): DeskEvent | null {
  if (trap.id !== "maturity-wall" || !trap.timeline) return null
  const years = [...trap.timeline.when.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]))
  if (!years.length) return null
  const start = Math.min(...years)
  const end = Math.max(...years)
  const due = `${end}-01-15`
  const [ty, tm] = today.split("-").map(Number)
  const months = (end - ty) * 12 + (1 - tm)
  const heat = months <= 18 ? 0.88 : months <= 36 ? 0.66 : 0.42
  return {
    date: `${start}-01-15`,
    until: `${end}-12-31`,
    ticker: "",
    label: "Refinance window",
    detail: clip(`${trap.timeline.title}. The window runs through ${due.slice(0, 4)}. ${trap.timeline.detail}`),
    heat,
  }
}

function keep(events: DeskEvent[]): DeskEvent[] {
  const pinned = events.filter((event) => event.label === "Next report" || event.label === "Refinance window")
  const rest = events.filter((event) => event.label !== "Next report" && event.label !== "Refinance window")
  rest.sort((a, b) => b.heat - a.heat || a.date.localeCompare(b.date))
  return [...pinned, ...rest.slice(0, 16)].sort((a, b) => a.date.localeCompare(b.date) || b.heat - a.heat)
}

/** Events the filing feed or the trial register already dated. Nothing here is a guessed launch or an FDA day that was not on the register. */
export function collectEvents(input: {
  ticker: string
  filings: Filing[]
  studies: SectorStudy[]
  traps: Trap[]
  kind: Memo["kind"]
  marks: InsiderMark[]
  now?: Date
}): DeskEvent[] {
  const today = iso(input.now ?? new Date())
  const past = addDays(today, -120)
  const future = addDays(today, 540)
  const events: DeskEvent[] = []

  for (const study of input.studies) {
    const date = studyDate(study.when)
    if (!date || date < past || date > future) continue
    events.push({
      date,
      ticker: input.ticker,
      label: trialLabel(study.phase),
      detail: clip(`${study.status}. ${study.title}. Primary completion is the date on the trial register, not a results press release.`),
      heat: trialHeat(study.phase),
    })
  }

  for (const filing of input.filings) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filing.date) || filing.date < past || filing.date > today) continue
    if (/13D/i.test(filing.form)) {
      events.push({
        date: filing.date,
        ticker: input.ticker,
        label: "Schedule 13D",
        detail: clip(filing.description || "A holder filed a Schedule 13D."),
        heat: 0.76,
      })
      continue
    }
    if (!/^8-K\b/.test(filing.form)) continue
    const item = hottestItem(filing.items)
    if (!item) continue
    events.push({
      date: filing.date,
      ticker: input.ticker,
      label: item.label,
      detail: clip(filing.description || `8-K items ${filing.items}.`),
      heat: item.heat,
    })
  }

  for (const mark of input.marks) {
    if (mark.date < past || mark.date > today) continue
    const shares = count(mark.shares)
    events.push({
      date: mark.date,
      ticker: input.ticker,
      label: mark.side === "buy" ? "Insider buy" : "Insider sale",
      detail: mark.side === "buy"
        ? `Open-market purchase of ${shares} shares on the Form 4. Grants are not counted.`
        : `Open-market sale of ${shares} shares on the Form 4. Grants and withholding are not counted.`,
      heat: mark.side === "buy" ? 0.5 : 0.28,
    })
  }

  for (const trap of input.traps) {
    const event = refinance(trap, today)
    if (!event) continue
    event.ticker = input.ticker
    if (event.until && event.until < today) continue
    if (event.date > future) continue
    events.push(event)
  }

  const upcoming = nextReport(input.filings, today, input.kind)
  if (upcoming) {
    events.push({
      date: upcoming.date,
      ticker: input.ticker,
      label: "Next report",
      detail: input.kind === "turnaround"
        ? `Projected ${upcoming.date} from the last periodic report on ${upcoming.latest}. The turnaround memo is waiting on the margin in a filing like this one.`
        : `Projected ${upcoming.date} from the last periodic report on ${upcoming.latest}. The date is the company's own filing rhythm.`,
      heat: input.kind === "turnaround" ? 0.58 : 0.12,
    })
  }

  const seen = new Set<string>()
  const unique = events.filter((event) => {
    const key = `${event.date}|${event.label}|${event.detail.slice(0, 40)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return keep(unique).map((event) => ({ ...event, ticker: input.ticker }))
}

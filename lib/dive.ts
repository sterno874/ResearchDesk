import { money, plainPct } from "./format"
import { companySic, loadAnnual, loadProxy } from "./filingdoc"
import { readAnnual, type AnnualRead, type SegmentLine } from "./ixbrl"
import { readPeople, type PeopleRead } from "./people"
import { getReport } from "./report"
import type { Report, Trap } from "./types"

export type DiveBlock =
  | { type: "p"; text: string }
  | { type: "note"; text: string }
  | { type: "figures"; items: { label: string; value: string }[] }
  | { type: "table"; caption: string; columns: string[]; rows: string[][] }
  | { type: "person"; name: string; meta: string; detail: string; bio: string | null }

export type DiveLayer = {
  id: string
  n: number
  title: string
  blocks: DiveBlock[]
}

export type DiveStep = {
  n: number
  title: string
  state: "done" | "now" | "ahead"
  href: string | null
}

export type Dive = {
  ticker: string
  name: string
  depth: number
  layers: DiveLayer[]
  steps: DiveStep[]
  next: { href: string; title: string; detail: string } | null
  sources: { label: string; url: string }[]
}

const STEPS = [
  { n: 1, title: "Shape" },
  { n: 2, title: "Business" },
  { n: 3, title: "Unit" },
  { n: 4, title: "Trend" },
  { n: 5, title: "Field" },
  { n: 6, title: "People" },
  { n: 7, title: "Open" },
]

type Totals = SegmentLine & { margin: number | null }

function totals(lines: SegmentLine[]): Totals[] {
  return lines
    .filter((line) => line.product == null && line.revenue != null)
    .map((line) => ({
      ...line,
      margin: line.ebitda != null && line.revenue ? line.ebitda / line.revenue : null,
    }))
    .sort((a, b) => b.year - a.year || (b.revenue ?? 0) - (a.revenue ?? 0))
}

function yearsOf(rows: Totals[]): number[] {
  return [...new Set(rows.map((row) => row.year))].sort((a, b) => b - a)
}

function radioLike(sic: string | null, name: string, rows: Totals[]): boolean {
  const blob = `${sic ?? ""} ${name} ${rows.map((row) => row.segment).join(" ")}`.toLowerCase()
  return sic === "4832" || /broadcast|radio|podcast|digital audio/.test(blob)
}

function satellite(name: string, sicDescription: string | null): boolean {
  return /sirius|satellite/i.test(`${name} ${sicDescription ?? ""}`)
}

function change(now: number | null, then: number | null): number | null {
  if (now == null || then == null || then === 0) return null
  return now / then - 1
}

export async function getDive(raw: string, depth: number): Promise<{ ok: true; dive: Dive } | { ok: false; ticker: string; message: string }> {
  const reportResult = await getReport(raw)
  if (!reportResult.ok) return reportResult
  const report = reportResult.report
  const level = Math.min(7, Math.max(1, depth))
  const { sic, sicDescription } = await companySic(report.metrics.cik)
  let annual: AnnualRead | null = null
  let annualUrl: string | null = null
  let annualFiled = ""
  let proxy: PeopleRead | null = null
  let proxyUrl: string | null = null
  let proxyFiled = ""
  const warnings: string[] = []

  if (level >= 2) {
    try {
      const doc = await loadAnnual(report.metrics.cik)
      if (!doc) warnings.push("No annual report was in the recent filing list.")
      else {
        annual = readAnnual(doc.html)
        annualUrl = doc.url
        annualFiled = doc.filed
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "The annual report didn't load.")
    }
  }
  if (level >= 6) {
    try {
      const doc = await loadProxy(report.metrics.cik)
      if (!doc) warnings.push("No proxy was in the recent filing list.")
      else {
        proxy = readPeople(doc.html)
        proxyUrl = doc.url
        proxyFiled = doc.filed
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "The proxy didn't load.")
    }
  }

  const layers = [
    shapeLayer(report, sicDescription),
    level >= 2 ? businessLayer(report, annual, warnings) : null,
    level >= 3 ? unitLayer(report, annual, sic, sicDescription) : null,
    level >= 4 ? trendLayer(report, annual) : null,
    level >= 5 ? fieldLayer(annual, sic, sicDescription, report.metrics.name) : null,
    level >= 6 ? peopleLayer(proxy, proxyUrl) : null,
    level >= 7 ? openLayer(report, annual, proxy) : null,
  ].filter((layer): layer is DiveLayer => layer != null)

  const steps: DiveStep[] = STEPS.map((step) => ({
    n: step.n,
    title: step.title,
    state: step.n < level ? "done" : step.n === level ? "now" : "ahead",
    href: step.n <= level ? `/dive/${report.metrics.ticker}?d=${step.n}#d${step.n}` : null,
  }))

  const next = level < 7
    ? {
        href: `/dive/${report.metrics.ticker}?d=${level + 1}#d${level + 1}`,
        title: level === 1 ? "Read the annual report" : level === 5 ? "Read the proxy" : "Go one level deeper",
        detail: level === 1
          ? "The next pass reads the 10-K: what they sell, the segments, and the unit the consolidated total hides."
          : level === 5
            ? "The next pass reads the proxy: who runs it, what they are paid, and what they own."
            : `Level ${level + 1} of 7, ${STEPS[level].title.toLowerCase()}.`,
      }
    : null

  const sources = [
    annualUrl ? { label: `Annual report filed ${annualFiled}`, url: annualUrl } : null,
    proxyUrl ? { label: `Proxy filed ${proxyFiled}`, url: proxyUrl } : null,
  ].filter((source): source is { label: string; url: string } => source != null)

  return { ok: true, dive: { ticker: report.metrics.ticker, name: report.metrics.name, depth: level, layers, steps, next, sources } }
}

function shapeLayer(report: Report, sicDescription: string | null): DiveLayer {
  const { metrics, traps } = report
  const revenue = metrics.series
    .filter((year) => year.revenue != null)
    .slice(0, 4)
    .map((year) => `${year.fy ?? year.end.slice(0, 4)} ${money(year.revenue)}`)
    .join(" · ")
  const lead = traps[0]
  return {
    id: "shape",
    n: 1,
    title: "The shape of it",
    blocks: [
      {
        type: "p",
        text: `${metrics.name}${sicDescription ? ` files as ${sicDescription.toLowerCase()}` : ""}. Revenue across the years on the blotter read: ${revenue || "not in the annual facts"}. Free cash flow is ${money(metrics.fcf)}. The equity is worth ${money(metrics.marketCap)} at ${money(metrics.price)} a share.`,
      },
      lead
        ? { type: "p", text: `The broad report already has a costume on it: ${lead.title}. ${lead.looksLike}` }
        : { type: "p", text: "The broad report did not find a costume in the consolidated numbers. That is a reason to keep going, not a reason to stop." },
      { type: "note", text: "This is the wide cut. The levels under it read the annual report and the proxy, and they stop where those documents stop." },
    ],
  }
}

function businessLayer(report: Report, annual: AnnualRead | null, warnings: string[]): DiveLayer {
  const rows = annual ? totals(annual.lines) : []
  const latest = rows.length ? Math.max(...rows.map((row) => row.year)) : null
  const segments = latest == null ? [] : rows.filter((row) => row.year === latest)
  const products = annual && latest != null
    ? annual.lines.filter((line) => line.year === latest && line.product && (line.revenue ?? 0) > 0)
    : []
  const blocks: DiveBlock[] = []
  if (warnings.length) blocks.push({ type: "note", text: warnings.join(" ") })
  if (annual?.overview) blocks.push({ type: "p", text: annual.overview })
  if (!annual?.overview) {
    blocks.push({ type: "p", text: "The annual report's business section did not come out as readable text. The segment tags, when they exist, are the firmer source." })
  }
  if (segments.length) {
    const ebitda = segments.find((row) => row.ebitdaLabel)?.ebitdaLabel ?? "Segment profit"
    blocks.push({
      type: "table",
      caption: `${latest}, from the segment footnote`,
      columns: ["Segment", "Revenue", "Share", ebitda, "Margin"],
      rows: segments.map((row) => {
        const share = report.metrics.revenue ? (row.revenue ?? 0) / report.metrics.revenue : null
        return [row.segment, money(row.revenue), plainPct(share, 0), money(row.ebitda), plainPct(row.margin, 0)]
      }),
    })
  }
  if (products.length) {
    blocks.push({
      type: "table",
      caption: `${latest} product lines inside those segments`,
      columns: ["Line", "Inside", "Revenue"],
      rows: products
        .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
        .map((line) => [line.product ?? "", line.segment, money(line.revenue)]),
    })
  }
  if (!segments.length && !products.length) {
    blocks.push({ type: "note", text: "This annual report did not tag reportable segments in a way the reader could total. The consolidated line is all the filing gives at this level." })
  }
  if (annual?.ebitdaDefinition) blocks.push({ type: "note", text: annual.ebitdaDefinition })
  return { id: "business", n: 2, title: "What the business sells", blocks }
}

function unitLayer(report: Report, annual: AnnualRead | null, sic: string | null, sicDescription: string | null): DiveLayer {
  const blocks: DiveBlock[] = []
  const rows = annual ? totals(annual.lines) : []
  const broadcast = radioLike(sic, report.metrics.name, rows) && !satellite(report.metrics.name, sicDescription)
  if (broadcast) {
    blocks.push({
      type: "p",
      text: "The unit of the advertising business is not a dollar of consolidated revenue. Cash spot revenue is listening hours times ad load, times the fill rate, times the price per unit. Digital delivery and programmatic selling are different axes. Digital is how the audio gets to someone. Programmatic is how the inventory is booked, and it can sit on broadcast and on digital. A segment called Digital Audio is not, by that name, the programmatic effort.",
    })
    if (annual?.programmatic) blocks.push({ type: "p", text: `The annual report's own words: ${annual.programmatic}` })
  } else if (satellite(report.metrics.name, sicDescription)) {
    blocks.push({ type: "p", text: "The unit here is a subscriber who pays. Listening hours, subscriber counts, and advertising revenue do not convert into one another, and this is a poor stand-in for an ad-supported broadcaster." })
  } else {
    blocks.push({ type: "p", text: "The unit is the thing that repeats and gets priced: a subscriber, a store, a ton, an ad. Consolidated revenue is that unit times a price, summed. Until the filing splits it, a growth rate is a blend of volume and price." })
  }

  const bridge = describeBridge(rows)
  if (bridge) blocks.push({ type: "p", text: bridge.text }, { type: "figures", items: bridge.figures })
  else blocks.push({ type: "note", text: "Two years of segment profit were not both tagged, so the bridge from a shrinking line to a growing line cannot be finished from this annual report." })
  return { id: "unit", n: 3, title: "The unit, and what offsets what", blocks }
}

function describeBridge(rows: Totals[]): { text: string; figures: { label: string; value: string }[] } | null {
  const years = yearsOf(rows)
  if (years.length < 2) return null
  const [latest, prior] = years
  const names = [...new Set(rows.map((row) => row.segment))]
  const pair = names.map((name) => {
    const now = rows.find((row) => row.segment === name && row.year === latest)
    const then = rows.find((row) => row.segment === name && row.year === prior)
    return {
      name,
      now,
      then,
      dRev: now?.revenue != null && then?.revenue != null ? now.revenue - then.revenue : null,
      dEbitda: now?.ebitda != null && then?.ebitda != null ? now.ebitda - then.ebitda : null,
    }
  }).filter((item) => item.dRev != null && item.now?.revenue && item.then?.revenue)
  const shrinking = pair.filter((item) => (item.dRev ?? 0) < 0).sort((a, b) => (a.dRev ?? 0) - (b.dRev ?? 0))[0]
  const growing = pair.filter((item) => (item.dRev ?? 0) > 0).sort((a, b) => (b.dRev ?? 0) - (a.dRev ?? 0))[0]
  if (!shrinking?.then?.revenue || shrinking.dRev == null) return null
  const shrinkMargin = shrinking.dEbitda != null ? shrinking.dEbitda / shrinking.dRev : null
  const point = shrinking.then.revenue * 0.01
  const pointCost = shrinkMargin != null && shrinkMargin > 0 && shrinkMargin < 1.25 ? point * shrinkMargin : null
  const label = shrinking.now?.ebitdaLabel ?? "segment profit"
  const figures = [
    { label: `${shrinking.name} revenue`, value: `${money(shrinking.then.revenue)} → ${money(shrinking.now?.revenue ?? null)}` },
    { label: `${shrinking.name} ${label}`, value: `${money(shrinking.then.ebitda)} → ${money(shrinking.now?.ebitda ?? null)}` },
    { label: "Drop-through", value: plainPct(shrinkMargin, 0) },
    { label: "One point of that revenue", value: pointCost != null ? money(pointCost) : "—" },
  ]
  let text = `From ${prior} to ${latest}, ${shrinking.name} revenue moved by ${money(shrinking.dRev)}. ${label} moved by ${money(shrinking.dEbitda)}. `
  if (shrinkMargin != null && shrinkMargin > 0 && shrinkMargin < 1.25) {
    text += `The observed drop-through is ${plainPct(shrinkMargin, 0)}: one point of ${shrinking.name} revenue, ${money(point)}, took about ${money(pointCost)} of ${label} with it. That is this year's filing, not a permanent cost.`
  } else {
    text += "The profit did not move in proportion to the revenue, so a single drop-through from this pair of years would be a costume. Use the two lines, not a blended company margin."
  }
  if (growing?.then?.revenue && growing.dRev != null && growing.dEbitda != null && shrinking.dEbitda != null && shrinking.dEbitda < 0) {
    const growMargin = growing.dEbitda / growing.dRev
    const hole = -shrinking.dEbitda
    const needed = growMargin > 0.05 && growMargin < 1.25 ? hole / growMargin : null
    const neededRate = needed != null ? needed / growing.then.revenue : null
    const actual = growing.dRev / growing.then.revenue
    figures.push(
      { label: `${growing.name} revenue`, value: `${money(growing.then.revenue)} → ${money(growing.now?.revenue ?? null)}` },
      { label: `${growing.name} ${label}`, value: `${money(growing.then.ebitda)} → ${money(growing.now?.ebitda ?? null)}` },
      { label: "Growth that fills the hole", value: plainPct(neededRate, 0) },
      { label: "Growth that happened", value: plainPct(actual, 0) },
    )
    text += ` ${growing.name} is the line that grew. Its observed flow-through was ${plainPct(growMargin, 0)}. The ${label} given up by ${shrinking.name} was ${money(hole)}.`
    if (neededRate != null) {
      text += ` At that flow-through, replacing it takes ${plainPct(neededRate, 0)} growth in ${growing.name}. The line grew ${plainPct(actual, 0)}. A blended company margin would ask for a different growth rate, and it would be the wrong one, because the incremental margin of the growing line is the margin that does the offsetting.`
    }
  }
  return { text, figures }
}

function trendLayer(report: Report, annual: AnnualRead | null): DiveLayer {
  const rows = annual ? totals(annual.lines) : []
  const years = yearsOf(rows).slice(0, 4).sort((a, b) => a - b)
  const blocks: DiveBlock[] = []
  const consolidated = [...report.metrics.series].reverse().filter((year) => year.revenue != null).slice(-4)
  if (consolidated.length) {
    blocks.push({
      type: "table",
      caption: "Consolidated, which is the line that can hide the mix",
      columns: ["Year", "Revenue", "Operating margin"],
      rows: consolidated.map((year) => [String(year.fy ?? year.end.slice(0, 4)), money(year.revenue), plainPct(year.operatingMargin, 1)]),
    })
  }
  if (years.length && rows.length) {
    const names = [...new Set(rows.map((row) => row.segment))]
    blocks.push({
      type: "table",
      caption: "Segment revenue",
      columns: ["Segment", ...years.map(String)],
      rows: names.map((name) => [
        name,
        ...years.map((year) => money(rows.find((row) => row.segment === name && row.year === year)?.revenue ?? null)),
      ]),
    })
    const withProfit = rows.some((row) => row.ebitda != null)
    if (withProfit) {
      const label = rows.find((row) => row.ebitdaLabel)?.ebitdaLabel ?? "Segment profit"
      blocks.push({
        type: "table",
        caption: label,
        columns: ["Segment", ...years.map(String)],
        rows: names.map((name) => [
          name,
          ...years.map((year) => {
            const row = rows.find((item) => item.segment === name && item.year === year)
            if (row?.ebitda == null) return "—"
            return row.margin != null ? `${money(row.ebitda)} · ${plainPct(row.margin, 0)}` : money(row.ebitda)
          }),
        ]),
      })
    }
  }
  blocks.push({
    type: "p",
    text: "Read the consolidated line only after the segments. A flat total is often a shrinking book and a growing book of the same size. The trend that matters is each book's revenue and its own margin, over the years the filing actually shows.",
  })
  return { id: "trend", n: 4, title: "How the lines have moved", blocks }
}

function fieldLayer(annual: AnnualRead | null, sic: string | null, sicDescription: string | null, name: string): DiveLayer {
  const blocks: DiveBlock[] = []
  if (sic === "4832" && !satellite(name, sicDescription)) {
    blocks.push({
      type: "p",
      text: "A subscription satellite service is the wrong comparison. Overlap in the car is a shared moment, not a shared customer, and willingness to pay is a different fact from willingness to listen. Hours, subscribers, and advertising revenue do not convert. The right field is other advertising: broadcast television outside primetime, inserted podcast ads, and the other buyers of audio inventory.",
    })
  }
  if (annual?.competition) blocks.push({ type: "p", text: annual.competition })
  if (annual?.rivals.length) {
    blocks.push({
      type: "p",
      text: `Names the competition section actually uses: ${annual.rivals.join(", ")}. A name in that section is a rival the company chose to mention. It is not a valuation comp until the customer and the unit match.`,
    })
  }
  if (!annual?.competition && !annual?.rivals.length) {
    blocks.push({ type: "note", text: "The competition discussion did not extract cleanly from this annual report. The field still has to be named before a multiple from another company is borrowed." })
  }
  return { id: "field", n: 5, title: "The field around it", blocks }
}

function peopleLayer(people: PeopleRead | null, url: string | null): DiveLayer {
  const blocks: DiveBlock[] = []
  if (!people || (!people.officers.length && !people.directors.length)) {
    blocks.push({ type: "note", text: "The proxy did not yield a clean officer list. The document is linked below. Titles, pay, and ownership belong to that filing, not to a biography written from memory." })
    return { id: "people", n: 6, title: "Who runs it", blocks }
  }
  if (people.groupOwnership) blocks.push({ type: "note", text: people.groupOwnership })
  for (const officer of people.officers) {
    const meta = [
      officer.role,
      officer.age != null ? `age ${officer.age}` : null,
      officer.since ? `on the board since ${officer.since}` : null,
    ].filter(Boolean).join(" · ")
    const pay = [
      officer.salary != null ? `salary ${money(officer.salary)}` : null,
      officer.equityPay != null ? `equity awards ${money(officer.equityPay)}` : null,
      officer.totalPay != null ? `total ${money(officer.totalPay)}` : null,
      officer.ownership ? `owns ${officer.ownership}` : null,
      officer.shares != null ? `${officer.shares.toLocaleString("en-US")} shares in that count` : null,
    ].filter(Boolean).join(" · ")
    blocks.push({
      type: "person",
      name: officer.name,
      meta,
      detail: pay,
      bio: officer.bio,
    })
  }
  const outside = people.directors.filter((director) => !people.officers.some((officer) => officer.name === director.name))
  if (outside.length) {
    blocks.push({
      type: "table",
      caption: "Directors who are not in the officer list",
      columns: ["Director", "Since", "Note"],
      rows: outside.map((director) => [director.name, director.since, director.note ?? ""]),
    })
  }
  if (url) blocks.push({ type: "note", text: "Pay is the latest year in the summary compensation table. Equity awards are grant-date values, not cash that left the building. Ownership is the proxy's beneficial-ownership count, which includes options and units that vest soon." })
  return { id: "people", n: 6, title: "Who runs it", blocks }
}

function openLayer(report: Report, annual: AnnualRead | null, people: PeopleRead | null): DiveLayer {
  const rows = annual ? totals(annual.lines) : []
  const questions = [
    "Listening hours, ad load, fill, and realized price are still not in the filing. The segment bridge says which book moved. It does not say which term inside the book moved.",
    "The trading price of the debt is not in the income statement. A refinance coupon has to be taken from the bonds, and the equity outcome depends on it.",
    "Political advertising, when it is part of the business, is every other year. The annual total does not isolate it unless a footnote does.",
    "A cost program already in the run-rate is not a second saving. Further savings are real when a later filing shows a lower cost line.",
  ]
  if (!rows.length) questions.unshift("Reportable segments were not readable, so the mix shift is still an open question.")
  if (!people?.officers.length) questions.push("The proxy did not produce an officer list on this pass. Who runs the place is still a document to read by hand.")
  const wall = report.traps.find((trap: Trap) => trap.id === "maturity-wall")
  if (wall?.timeline) questions.unshift(`${wall.timeline.detail}`)
  return {
    id: "open",
    n: 7,
    title: "What is still unknown",
    blocks: [
      { type: "p", text: "A finished dive is a list of the facts the documents support and a list of the facts they don't. These are the ones this pass cannot close." },
      ...questions.map((text): DiveBlock => ({ type: "p", text })),
    ],
  }
}


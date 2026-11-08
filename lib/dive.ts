import { money, plainPct, price } from "./format"
import { companySic, loadAnnual, loadProxy } from "./filingdoc"
import { readAnnual, type AnnualRead, type SegmentLine } from "./ixbrl"
import { mergePeople, readFilingPeople, readPeople, type PeopleRead } from "./people"
import { shorthand } from "./rank"
import { getReport } from "./report"
import { saveRead } from "./reads"
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

function books(currency: string | null | undefined): string {
  return currency || "USD"
}

function statedIn(report: Report): string {
  return report.metrics.statementCurrency || report.metrics.currency || "USD"
}

function sameMoney(currency: string | null | undefined, report: Report): boolean {
  return books(currency) === statedIn(report)
}

function cash(n: number | null, currency?: string | null): string {
  return money(n, books(currency))
}

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
  let filingPeople: PeopleRead | null = null
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
        filingPeople = readFilingPeople(doc.html)
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
      if (!doc) {
        warnings.push("No proxy was in the recent filing list.")
        proxy = filingPeople
      } else {
        proxy = mergePeople(readPeople(doc.html), filingPeople)
        proxyUrl = doc.url
        proxyFiled = doc.filed
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "The proxy didn't load.")
      proxy = filingPeople
    }
  }

  const layers = [
    shapeLayer(report, sicDescription),
    level >= 2 ? businessLayer(report, annual, warnings) : null,
    level >= 3 ? unitLayer(report, annual, sic, sicDescription) : null,
    level >= 4 ? trendLayer(report, annual) : null,
    level >= 5 ? fieldLayer(annual, sic, sicDescription, report.metrics.name) : null,
    level >= 6 ? peopleLayer(proxy, proxyUrl) : null,
    level >= 7 ? openLayer(report, annual, proxy, sic, sicDescription) : null,
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

  const base = shorthand({ ...report, gaps: gapsAfterDive(report.gaps, level, annual, proxy) })
  await saveRead({
    ...base,
    depth: level,
    why: `${base.why} ${diveNote(level, annual, proxy)}`,
    readAt: new Date().toISOString(),
  }).catch(() => undefined)

  return { ok: true, dive: { ticker: report.metrics.ticker, name: report.metrics.name, depth: level, layers, steps, next, sources } }
}

function gapsAfterDive(gaps: string[], level: number, annual: AnnualRead | null, proxy: PeopleRead | null): string[] {
  const next = new Set(gaps)
  const split = annual?.lines.some((line) => (line.revenue ?? 0) > 0) ?? false
  if (level >= 2 && split) next.delete("what the business sells")
  if (level >= 2 && annual && !split) next.add("what the business sells")
  if (level >= 6 && proxy && proxy.officers.length > 0) next.delete("who runs it")
  if (level >= 6 && (!proxy || proxy.officers.length === 0)) next.add("who runs it")
  return [...next]
}

function diveNote(level: number, annual: AnnualRead | null, proxy: PeopleRead | null): string {
  const step = STEPS[level - 1]?.title ?? "Shape"
  if (level >= 6 && proxy) {
    const officers = proxy.officers.length
    const named = officers ? ` The proxy names ${officers} officer${officers === 1 ? "" : "s"}.` : " The proxy was read."
    return `The dive is through ${step}, ${level} of 7.${named} The stars start from the median of the six readers.`
  }
  if (level >= 2 && annual) {
    const segments = new Set(annual.lines.filter((line) => line.product == null && (line.revenue ?? 0) > 0).map((line) => line.segment)).size
    const named = segments ? ` The annual report tags ${segments} segment${segments === 1 ? "" : "s"}.` : " The annual report was read."
    return `The dive is through ${step}, ${level} of 7.${named} The stars start from the median of the six readers.`
  }
  if (level >= 2) {
    return `The dive reached ${step}, ${level} of 7. The annual report did not add a segment table. The stars start from the median of the six readers.`
  }
  return "The wide cut was refreshed. The stars start from the median of the six readers."
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
        text: `${metrics.name}${sicDescription ? ` files as ${sicDescription.toLowerCase()}` : ""}. Revenue across the years on the blotter read: ${revenue || "not in the annual facts"}. Free cash flow is ${money(metrics.fcf)}. The equity is worth ${money(metrics.marketCap)} at ${price(metrics.price)} a share.`,
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
    const currency = books(segments[0]?.currency)
    const segmentTotal = segments.reduce((sum, line) => books(line.currency) === currency ? sum + (line.revenue ?? 0) : sum, 0)
    const consolidated = sameMoney(segments[0]?.currency, report) ? report.metrics.revenue : null
    const between = consolidated != null && consolidated > 0 && segmentTotal > consolidated * 1.05
    blocks.push({
      type: "table",
      caption: consolidated != null ? `${latest}, from the segment footnote` : `${latest}, from the segment footnote, in ${currency}`,
      columns: ["Segment", "Revenue", "Share", ebitda, "Margin"],
      rows: segments.map((row) => {
        const pool = consolidated != null && !between ? consolidated : segmentTotal
        const share = pool && books(row.currency) === currency ? (row.revenue ?? 0) / pool : null
        return [row.segment, cash(row.revenue, row.currency), plainPct(share, 0), cash(row.ebitda, row.currency), plainPct(row.margin, 0)]
      }),
    })
    if (between) {
      blocks.push({ type: "note", text: "These revenues include sales between segments. The shares are of that total, not of consolidated revenue." })
    }
  }
  const categories = products.filter((line) => line.segment === "Category")
  const rollup = products.filter((line) => line.segment === "Rollup")
  const channels = products.filter((line) => line.segment === "Channel")
  const nested = products.filter((line) => line.segment !== "Category" && line.segment !== "Rollup" && line.segment !== "Channel")
  if (categories.length) {
    const categoryTotal = categories.reduce((sum, line) => sum + (line.revenue ?? 0), 0)
    blocks.push({
      type: "table",
      caption: sameMoney(categories[0]?.currency, report) ? `${latest} net sales by what is sold` : `${latest} net sales by what is sold, in ${books(categories[0]?.currency)}`,
      columns: ["Category", "Revenue", "Share"],
      rows: categories
        .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
        .map((line) => [line.product ?? "", cash(line.revenue, line.currency), plainPct(categoryTotal ? (line.revenue ?? 0) / categoryTotal : null, 0)]),
    })
  }
  if (rollup.length) {
    blocks.push({
      type: "table",
      caption: `${latest} products and services, with the gross margin the filing tags`,
      columns: ["Group", "Revenue", "Cost", "Gross margin"],
      rows: rollup
        .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
        .map((line) => [line.product ?? "", cash(line.revenue, line.currency), cash(line.direct, line.currency), plainPct(grossMargin(line), 1)]),
    })
  }
  if (channels.length) {
    const channelTotal = channels.reduce((sum, line) => sum + (line.revenue ?? 0), 0)
    blocks.push({
      type: "table",
      caption: `${latest} wholesale and direct`,
      columns: ["Channel", "Revenue", "Share"],
      rows: channels
        .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
        .map((line) => [line.product ?? "", cash(line.revenue, line.currency), plainPct(channelTotal ? (line.revenue ?? 0) / channelTotal : null, 0)]),
    })
  }
  if (segments.some((row) => /before shared costs/i.test(row.ebitdaLabel ?? ""))) {
    blocks.push({ type: "note", text: "Brand operating income is the figure the company assigns to the brand, before the costs it does not allocate." })
  }
  if (nested.length) {
    blocks.push({
      type: "table",
      caption: `${latest} product lines inside those segments`,
      columns: ["Line", "Inside", "Revenue"],
      rows: nested
        .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
        .map((line) => [line.product ?? "", line.segment, cash(line.revenue, line.currency)]),
    })
  }
  if (!segments.length && !products.length) {
    blocks.push({ type: "note", text: "This annual report did not tag reportable segments in a way the reader could total. The consolidated line is all the filing gives at this level." })
  }
  const foreign = [...segments, ...products].find((line) => !sameMoney(line.currency, report))
  if (foreign) {
    blocks.push({
      type: "note",
      text: `These lines are in ${books(foreign.currency)}. Consolidated revenue is in ${statedIn(report)}. The filing did not give a rate, so the lines are left in their own currency and are not a share of that total.`,
    })
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
  } else if (annual && categoryLines(annual).length) {
    blocks.push({ type: "p", text: categoryUnit(annual, report) })
    if (annual.drivers.length) blocks.push({ type: "p", text: `The annual report's own account of the change: ${annual.drivers.join(" ")}` })
  } else if (rows.length || (annual && annual.lines.some((line) => line.segment === "Channel"))) {
    blocks.push({ type: "p", text: segmentUnit(report, annual, rows) })
  } else {
    blocks.push({ type: "p", text: "The unit is the thing that repeats and gets priced: a subscriber, a store, a ton, an ad. Consolidated revenue is that unit times a price, summed. Until the filing splits it, a growth rate is a blend of volume and price." })
  }

  const bridge = describeBridge(rows)
  if (bridge) blocks.push({ type: "p", text: bridge.text }, { type: "figures", items: bridge.figures })
  else if (grewAcross(rows)) blocks.push({ type: "note", text: "Every reportable segment with two years of revenue grew. There is no shrinking book to offset against a growing one." })
  else blocks.push({ type: "note", text: "Two years of segment profit were not both tagged, so the bridge from a shrinking line to a growing line cannot be finished from this annual report." })
  return { id: "unit", n: 3, title: "The unit, and what offsets what", blocks }
}

function segmentUnit(report: Report, annual: AnnualRead | null, rows: Totals[]): string {
  const years = yearsOf(rows)
  const latest = years[0]
  const current = latest == null ? [] : rows.filter((row) => row.year === latest).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
  const [lead, second] = current
  const total = report.metrics.revenue
  const segmentTotal = current.reduce((sum, row) => sum + (row.revenue ?? 0), 0)
  const between = total != null && total > 0 && sameMoney(lead?.currency, report) && segmentTotal > total * 1.05
  const branded = current.some((row) => /brand/i.test(row.segment))
  let text = branded
    ? "The filing splits the business by brand rather than by a counted unit."
    : "The filing splits sales by the segments it reports."
  if (lead?.revenue != null && between) {
    text = `${lead.segment} reports ${cash(lead.revenue, lead.currency)}.`
    if (second?.revenue != null) text += ` ${second.segment} reports ${cash(second.revenue, second.currency)}.`
    text += " Those figures include sales between segments, so they are not a share of consolidated sales."
  } else if (lead?.revenue != null && total && sameMoney(lead.currency, report)) {
    text = `${lead.segment} is ${plainPct(lead.revenue / total, 0)} of sales, ${cash(lead.revenue, lead.currency)}.`
    if (second?.revenue != null) text += ` ${second.segment} is ${plainPct(second.revenue / total, 0)}, ${cash(second.revenue, second.currency)}.`
  } else if (lead?.revenue != null) {
    text += ` ${lead.segment} is ${cash(lead.revenue, lead.currency)}.`
    if (second?.revenue != null) text += ` ${second.segment} is ${cash(second.revenue, second.currency)}.`
  }
  if (lead?.ebitda != null) {
    const label = (lead.ebitdaLabel ?? "Operating income").toLowerCase()
    text += ` ${lead.segment} ${label} is ${cash(lead.ebitda, lead.currency)}`
    text += lead.margin != null ? `, ${plainPct(lead.margin, 0)} of its sales.` : "."
    if (second?.ebitda != null) text += ` ${second.segment} is ${cash(second.ebitda, second.currency)}${second.margin != null ? `, ${plainPct(second.margin, 0)}` : ""}.`
  }
  const channels = (annual?.lines ?? []).filter((line) => line.segment === "Channel" && line.year === latest && (line.revenue ?? 0) > 0)
  if (channels.length) {
    text += ` By channel, ${channels
      .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
      .map((line) => `${line.product} ${cash(line.revenue, line.currency)}`)
      .join(" and ")}.`
  }
  text += " The count of units sold, and the price of one unit, are not separated. A change in revenue is still volume and price together."
  return text
}

function grossMargin(line: { revenue: number | null; direct: number | null }): number | null {
  if (line.revenue == null || line.direct == null || line.revenue === 0) return null
  return (line.revenue - line.direct) / line.revenue
}

function categoryLines(annual: AnnualRead): SegmentLine[] {
  const rows = annual.lines.filter((line) => line.segment === "Category" && line.product && (line.revenue ?? 0) > 0)
  if (!rows.length) return []
  const latest = Math.max(...rows.map((line) => line.year))
  return rows.filter((line) => line.year === latest).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
}

function categoryUnit(annual: AnnualRead, report: Report): string {
  const categories = categoryLines(annual)
  const total = categories.reduce((sum, line) => sum + (line.revenue ?? 0), 0)
  const lead = categories[0]
  const share = lead?.revenue != null && total ? lead.revenue / total : null
  const rollup = annual.lines.filter((line) => line.segment === "Rollup" && line.year === lead?.year)
  const products = rollup.find((line) => line.product === "Products")
  const services = rollup.find((line) => line.product === "Services")
  let text = lead
    ? `The filing splits sales by what is sold. ${lead.product} is ${plainPct(share, 0)} of that, ${cash(lead.revenue, lead.currency)}.`
    : "The filing splits sales by what is sold."
  const productMargin = products ? grossMargin(products) : null
  const serviceMargin = services ? grossMargin(services) : null
  if (products && services && productMargin != null && serviceMargin != null) {
    text += ` Products as a group earned a ${plainPct(productMargin, 1)} gross margin on ${cash(products.revenue, products.currency)}. Services earned ${plainPct(serviceMargin, 1)} on ${cash(services.revenue, services.currency)}. The consolidated margin is a blend of those two.`
    if (serviceMargin > productMargin) text += " The services line is the richer margin."
  }
  text += " Units sold, and the price of one unit, are not in the filing. A growth rate here is still a blend of volume and price."
  if (lead && !sameMoney(lead.currency, report)) {
    text += ` These lines are in ${books(lead.currency)}. Consolidated revenue is in ${statedIn(report)}, and the filing did not give a rate, so this is not a share of that total.`
  } else if (report.metrics.revenue && total && Math.abs(total - report.metrics.revenue) / report.metrics.revenue > 0.05) {
    text += " The category tags do not add up to the consolidated revenue, so the split is incomplete."
  }
  return text
}

function grewAcross(rows: Totals[]): boolean {
  const years = yearsOf(rows)
  if (years.length < 2) return false
  const [latest, prior] = years
  const names = [...new Set(rows.map((row) => row.segment))]
  const paired = names.map((name) => {
    const now = rows.find((row) => row.segment === name && row.year === latest)?.revenue
    const then = rows.find((row) => row.segment === name && row.year === prior)?.revenue
    return now != null && then != null ? now - then : null
  }).filter((delta): delta is number => delta != null)
  return paired.length >= 2 && paired.every((delta) => delta >= 0)
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
    { label: `${shrinking.name} revenue`, value: `${cash(shrinking.then.revenue, shrinking.then.currency)} → ${cash(shrinking.now?.revenue ?? null, shrinking.now?.currency)}` },
    { label: `${shrinking.name} ${label}`, value: `${cash(shrinking.then.ebitda, shrinking.then.currency)} → ${cash(shrinking.now?.ebitda ?? null, shrinking.now?.currency)}` },
    { label: "Drop-through", value: plainPct(shrinkMargin, 0) },
    { label: "One point of that revenue", value: pointCost != null ? cash(pointCost, shrinking.then.currency) : "—" },
  ]
  let text = `From ${prior} to ${latest}, ${shrinking.name} revenue moved by ${cash(shrinking.dRev, shrinking.then.currency)}. ${label} moved by ${cash(shrinking.dEbitda, shrinking.then.currency)}. `
  if (shrinkMargin != null && shrinkMargin > 0 && shrinkMargin < 1.25) {
    text += `The observed drop-through is ${plainPct(shrinkMargin, 0)}: one point of ${shrinking.name} revenue, ${cash(point, shrinking.then.currency)}, took about ${cash(pointCost, shrinking.then.currency)} of ${label} with it. That is this year's filing, not a permanent cost.`
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
      { label: `${growing.name} revenue`, value: `${cash(growing.then.revenue, growing.then.currency)} → ${cash(growing.now?.revenue ?? null, growing.now?.currency)}` },
      { label: `${growing.name} ${label}`, value: `${cash(growing.then.ebitda, growing.then.currency)} → ${cash(growing.now?.ebitda ?? null, growing.now?.currency)}` },
      { label: "Growth that fills the hole", value: plainPct(neededRate, 0) },
      { label: "Growth that happened", value: plainPct(actual, 0) },
    )
    text += ` ${growing.name} is the line that grew. Its observed flow-through was ${plainPct(growMargin, 0)}. The ${label} given up by ${shrinking.name} was ${cash(hole, shrinking.then.currency)}.`
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
  if (consolidated.length >= 2) {
    const first = consolidated[0]
    const last = consolidated[consolidated.length - 1]
    const firstYear = first.fy ?? first.end.slice(0, 4)
    const lastYear = last.fy ?? last.end.slice(0, 4)
    blocks.push({
      type: "p",
      text: `Consolidated revenue went from ${money(first.revenue)} in ${firstYear} to ${money(last.revenue)} in ${lastYear}. Operating margin went from ${plainPct(first.operatingMargin, 1)} to ${plainPct(last.operatingMargin, 1)}.`,
    })
  }
  if (consolidated.length) {
    blocks.push({
      type: "table",
      caption: "Consolidated, which is the line that can hide the mix",
      columns: ["Year", "Revenue", "Operating margin"],
      rows: consolidated.map((year) => [String(year.fy ?? year.end.slice(0, 4)), money(year.revenue), plainPct(year.operatingMargin, 1)]),
    })
  }
  if (annual) {
    const categories = annual.lines.filter((line) => line.segment === "Category" && line.product && (line.revenue ?? 0) > 0)
    const categoryYears = [...new Set(categories.map((line) => line.year))].sort((a, b) => a - b).slice(-4)
    const categoryNames = [...new Set(categories.map((line) => line.product ?? ""))]
    if (categoryYears.length && categoryNames.length) {
      blocks.push({
        type: "table",
        caption: categories.some((line) => line.currency && line.currency !== "USD") ? `Net sales by category, in ${books(categories[0]?.currency)}` : "Net sales by category",
        columns: ["Category", ...categoryYears.map(String)],
        rows: categoryNames.map((name) => [
          name,
          ...categoryYears.map((year) => {
            const line = categories.find((item) => item.product === name && item.year === year)
            return cash(line?.revenue ?? null, line?.currency)
          }),
        ]),
      })
    }
  }
  if (years.length && rows.length) {
    const names = [...new Set(rows.map((row) => row.segment))]
    blocks.push({
      type: "table",
      caption: "Segment revenue",
      columns: ["Segment", ...years.map(String)],
      rows: names.map((name) => [
        name,
        ...years.map((year) => {
          const row = rows.find((item) => item.segment === name && item.year === year)
          return cash(row?.revenue ?? null, row?.currency)
        }),
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
            return row.margin != null ? `${cash(row.ebitda, row.currency)} · ${plainPct(row.margin, 0)}` : cash(row.ebitda, row.currency)
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
  if (annual?.competitiveFactors && annual.competitiveFactors !== annual.competition) {
    blocks.push({ type: "p", text: annual.competitiveFactors })
  }
  const rivals = (annual?.rivals ?? []).filter((rival) => !sameFirm(rival, name))
  if (rivals.length) {
    blocks.push({
      type: "p",
      text: `Names the competition section actually uses: ${rivals.join(", ")}. A name in that section is a rival the company chose to mention. It is not a valuation comp until the customer and the unit match.`,
    })
  } else if (annual?.competition) {
    blocks.push({ type: "note", text: "The competition section describes how the company competes. It does not name the other companies." })
  }
  if (!annual?.competition && !rivals.length) {
    blocks.push({ type: "note", text: "The competition discussion did not extract cleanly from this annual report. The field still has to be named before a multiple from another company is borrowed." })
  }
  return { id: "field", n: 5, title: "The field around it", blocks }
}

function sameFirm(rival: string, company: string): boolean {
  const key = (value: string) => value.toLowerCase().replace(/\b(inc|incorporated|corp|corporation|ltd|limited|co|company|the)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim()
  const left = key(rival)
  const right = key(company)
  return Boolean(left) && (left === right || right.startsWith(left) || left.startsWith(right))
}

function peopleLayer(people: PeopleRead | null, url: string | null): DiveLayer {
  const blocks: DiveBlock[] = []
  if (!people || (!people.officers.length && !people.directors.length)) {
    blocks.push({ type: "note", text: "The proxy did not yield a clean officer list. The document is linked below. Titles, pay, and ownership belong to that filing, not to a biography written from memory." })
    return { id: "people", n: 6, title: "Who runs it", blocks }
  }
  blocks.push({
    type: "note",
    text: "The filing names the officers, the job, and a short biography when it printed one. It does not say who reports to whom, so this is the roster in the document, not a chart drawn past it.",
  })
  if (people.groupOwnership) blocks.push({ type: "note", text: people.groupOwnership })
  if (people.holders.length) {
    blocks.push({
      type: "note",
      text: `Holders of 5% or more, from the same table: ${people.holders.map((holder) => `${holder.name} ${holder.ownership} (${holder.shares.toLocaleString("en-US")} shares)`).join("; ")}.`,
    })
  }
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
  for (const director of outside.filter((person) => person.bio)) {
    blocks.push({
      type: "person",
      name: director.name,
      meta: [`Director since ${director.since}`, director.note].filter(Boolean).join(" · "),
      detail: "",
      bio: director.bio,
    })
  }
  const bare = outside.filter((director) => !director.bio)
  if (bare.length) {
    blocks.push({
      type: "table",
      caption: "Directors whose biographies did not extract",
      columns: ["Director", "Since", "Note"],
      rows: bare.map((director) => [director.name, director.since, director.note ?? ""]),
    })
  }
  if (url) blocks.push({ type: "note", text: "Pay is the latest year in the summary compensation table. Equity awards are grant-date values, not cash that left the building. Ownership is the proxy's beneficial-ownership count, which includes options and units that vest soon." })
  return { id: "people", n: 6, title: "Who runs it", blocks }
}

function openLayer(report: Report, annual: AnnualRead | null, people: PeopleRead | null, sic: string | null, sicDescription: string | null): DiveLayer {
  const rows = annual ? totals(annual.lines) : []
  const questions: string[] = []
  const broadcast = radioLike(sic, report.metrics.name, rows) && !satellite(report.metrics.name, sicDescription)
  const wall = report.traps.find((trap: Trap) => trap.id === "maturity-wall")
  if (wall?.timeline) questions.push(wall.timeline.detail)
  else if ((report.metrics.debt ?? 0) > (report.metrics.equity ?? 0) && (report.metrics.debt ?? 0) > 0) {
    questions.push("The debt is larger than the equity. The coupon on a refinance is not in the income statement, and the equity outcome depends on it.")
  }
  if (broadcast) {
    questions.push("Listening hours, ad load, fill, and realized price are still not in the filing. The segment bridge says which book moved. It does not say which term inside the book moved.")
    questions.push("Political advertising, when it is part of the business, is every other year. The annual total does not isolate it unless a footnote does.")
  }
  const categories = annual ? categoryLines(annual) : []
  if (categories.length) questions.push("The filing gives dollars by product and a reason for the change. It does not give units sold or a price, so volume and price stay mixed.")
  else if (!rows.length) questions.push("Reportable segments were not readable, so the mix shift is still an open question.")
  if (rows.length && rows.every((row) => row.ebitda == null)) questions.push("The segments show revenue and not profit, so which line earns the margin is still outside this footnote.")
  const named = (annual?.rivals ?? []).filter((rival) => !sameFirm(rival, report.metrics.name))
  if (annual && !named.length) questions.push("The competition section does not name the other companies. A multiple borrowed from a peer is not supported by this annual report.")
  if (!people?.officers.length) questions.push("The proxy did not produce an officer list on this pass. Who runs the place is still a document to read by hand.")
  else if (people.officers.some((officer) => !officer.bio && !/^former\b/i.test(officer.role))) questions.push("At least one current officer has a title and no biography from the proxy.")
  if (!questions.length) questions.push("The documents read on this pass name the business, the mix, and the people. What they still do not separate is units and price.")
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


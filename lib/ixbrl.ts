import { htmlToText, sentenceAround, sentences } from "./plain"

export type SegmentLine = {
  segment: string
  product: string | null
  year: number
  revenue: number | null
  ebitda: number | null
  ebitdaLabel: string | null
  direct: number | null
  sga: number | null
}

export type AnnualRead = {
  lines: SegmentLine[]
  overview: string
  competition: string
  programmatic: string
  ebitdaDefinition: string
  rivals: string[]
}

type Member = { dimension: string; name: string }
type Kind = "revenue" | "ebitda" | "direct" | "sga"

function localName(value: string): string {
  return value.split(":").pop() || value
}

function words(member: string): string {
  const stem = localName(member)
    .replace(/GroupSegmentMember$/, "")
    .replace(/SegmentMember$/, "")
    .replace(/Member$/, "")
  return stem
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bNon\b/g, "excluding")
    .replace(/\bAnd\b/g, "and")
    .replace(/ excluding (\w+)/, (_, word: string) => `, excluding ${word.toLowerCase()}`)
    .replace(/\s+/g, " ")
    .trim()
}

function annualSpan(start: string, end: string): boolean {
  const days = (Date.parse(end) - Date.parse(start)) / 86400000
  return Number.isFinite(days) && days >= 330 && days <= 400
}

function kindOf(name: string): { kind: Kind; rank: number; ebitdaLabel: string | null } | null {
  const local = localName(name)
  if (local === "Revenues") return { kind: "revenue", rank: 3, ebitdaLabel: null }
  if (local.startsWith("RevenueFromContractWithCustomer")) return { kind: "revenue", rank: 2, ebitdaLabel: null }
  if (/AdjustedEarningsBeforeInterestTaxesDepreciation/i.test(local)) {
    return { kind: "ebitda", rank: 3, ebitdaLabel: "Adjusted EBITDA" }
  }
  if (/EarningsBeforeInterestTaxesDepreciationAndAmortization$/i.test(local)) {
    return { kind: "ebitda", rank: 2, ebitdaLabel: "EBITDA" }
  }
  if (local === "DirectOperatingCostsNet" || local === "CostOfRevenue" || local === "CostOfGoodsAndServicesSold") {
    return { kind: "direct", rank: 2, ebitdaLabel: null }
  }
  if (/SellingGeneralAndAdministrative/.test(local)) return { kind: "sga", rank: 2, ebitdaLabel: null }
  return null
}

function amount(raw: string, scale: string | undefined, sign: string | undefined): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/\s/g, "")
  if (!cleaned || cleaned === "-" || cleaned === "—" || cleaned === "–") return 0
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  const power = Number(scale ?? "0")
  const scaled = value * 10 ** (Number.isFinite(power) ? power : 0)
  return sign === "-" ? -scaled : scaled
}

function attrs(source: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) found[match[1]] = match[2]
  return found
}

function isSegmentMember(member: Member): boolean {
  const name = localName(member.name)
  return /SegmentMember$/.test(name) && !/^OperatingSegmentsMember$/.test(name)
}

function isSkipped(member: Member): boolean {
  return /Intersegment|Elimination|Corporate|Reconciling/.test(localName(member.name))
}

function isProduct(member: Member): boolean {
  const name = localName(member.name)
  if (isSegmentMember(member) || isSkipped(member)) return false
  if (/OperatingSegmentsMember$/.test(name)) return false
  return /ProductOrServiceAxis/.test(member.dimension) || /Member$/.test(name)
}

type Slot = {
  segment: string
  product: string | null
  year: number
  revenue: number | null
  revenueRank: number
  ebitda: number | null
  ebitdaRank: number
  ebitdaLabel: string | null
  direct: number | null
  sga: number | null
}

function looksLikeContents(after: string): boolean {
  const window = after.slice(0, 420)
  const pageHits = window.match(/\bpages?\b/gi)?.length ?? 0
  return pageHits >= 2 || /\bitem\s+1a\b/i.test(window.slice(0, 280))
}

function clipItem(rest: string): string {
  const trimmed = rest.trim()
  const end = trimmed.search(/\bitem\s+1a\b/i)
  return (end > 500 ? trimmed.slice(0, end) : trimmed.slice(0, 8000)).trim()
}

function readItem(plain: string): string {
  const pattern = /item\s+1\.\s+business/gi
  let bestAt = -1
  let bestScore = 0
  for (const match of plain.matchAll(pattern)) {
    const after = plain.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 320)
    if (/^\s*[–—\-."”]/.test(after)) continue
    if (/^\s*(item|part|see|under)\b/i.test(after)) continue
    if (looksLikeContents(after)) continue
    const score = (after.match(/[a-z]/g) || []).length
    if (score > bestScore) {
      bestScore = score
      bestAt = (match.index ?? 0) + match[0].length
    }
  }
  if (bestAt >= 0 && bestScore >= 40) return clipItem(plain.slice(bestAt))

  const narrative = /\boverview\s+(we\s+(?:are|design|operate|provide|develop|manufacture|own|sell|believe)\b)/gi
  for (const match of plain.matchAll(narrative)) {
    const opener = match[1]
    const at = (match.index ?? 0) + match[0].length - opener.length
    const before = plain.slice(Math.max(0, at - 90), at)
    if (/table of contents/i.test(before)) continue
    return clipItem(plain.slice(at))
  }
  return ""
}

function rivalsIn(competition: string): string[] {
  const found = new Set<string>()
  const pattern = /\b([A-Z][A-Za-z&.'’-]+(?:\s+[A-Z][A-Za-z&.'’-]+){0,3})\s+(Inc\.|Corp\.|Corporation|LLC|Ltd\.|Co\.)/g
  for (const match of competition.matchAll(pattern)) {
    const name = `${match[1]} ${match[2]}`.replace(/\s+/g, " ")
    if (/^(The|Our|Item|Part|United|Federal|Commission|Company|Securities)\b/.test(name)) continue
    found.add(name)
    if (found.size >= 8) break
  }
  return [...found]
}

export function readAnnual(html: string): AnnualRead {
  const contexts = new Map<string, { start: string; end: string; members: Member[] }>()
  for (const match of html.matchAll(/<xbrli:context id="([^"]+)">([\s\S]*?)<\/xbrli:context>/g)) {
    const body = match[2]
    const start = body.match(/<xbrli:startDate>([^<]+)<\/xbrli:startDate>/)
    const end = body.match(/<xbrli:endDate>([^<]+)<\/xbrli:endDate>/)
    if (!start || !end || !annualSpan(start[1], end[1])) continue
    const members: Member[] = []
    for (const member of body.matchAll(/<xbrldi:explicitMember\b([^>]*)>([^<]+)<\/xbrldi:explicitMember>/g)) {
      const dimension = attrs(member[1]).dimension || ""
      members.push({ dimension, name: member[2] })
    }
    if (members.length) contexts.set(match[1], { start: start[1], end: end[1], members })
  }

  const slots = new Map<string, Slot>()
  for (const match of html.matchAll(/<ix:nonFraction\b([^>]*)>([^<]*)<\/ix:nonFraction>/g)) {
    const fact = attrs(match[1])
    const context = contexts.get(fact.contextRef || "")
    const meta = kindOf(fact.name || "")
    if (!context || !meta) continue
    if (context.members.some(isSkipped)) continue
    const segmentMember = context.members.find(isSegmentMember)
    if (!segmentMember) continue
    const productMember = context.members.find(isProduct)
    const value = amount(match[2], fact.scale, fact.sign)
    if (value == null) continue
    const year = Number(context.end.slice(0, 4))
    const segment = words(segmentMember.name)
    const product = productMember ? words(productMember.name) : null
    const key = `${year}|${segment}|${product ?? ""}`
    const slot = slots.get(key) ?? {
      segment,
      product,
      year,
      revenue: null,
      revenueRank: 0,
      ebitda: null,
      ebitdaRank: 0,
      ebitdaLabel: null,
      direct: null,
      sga: null,
    }
    if (meta.kind === "revenue" && meta.rank >= slot.revenueRank) {
      slot.revenue = value
      slot.revenueRank = meta.rank
    } else if (meta.kind === "ebitda" && meta.rank >= slot.ebitdaRank) {
      slot.ebitda = value
      slot.ebitdaRank = meta.rank
      slot.ebitdaLabel = meta.ebitdaLabel
    } else if (meta.kind === "direct" && slot.direct == null) {
      slot.direct = value
    } else if (meta.kind === "sga" && slot.sga == null) {
      slot.sga = value
    }
    slots.set(key, slot)
  }

  const lines: SegmentLine[] = [...slots.values()]
    .filter((slot) => (slot.revenue ?? 0) > 0 || (slot.ebitda ?? 0) !== 0)
    .map((slot) => ({
      segment: slot.segment,
      product: slot.product,
      year: slot.year,
      revenue: slot.revenue,
      ebitda: slot.ebitda,
      ebitdaLabel: slot.ebitdaLabel,
      direct: slot.direct,
      sga: slot.sga,
    }))

  const plain = htmlToText(html)
  const item = readItem(plain)
  const competitionAt = item.search(/\bCompetition\b/)
  const competition = competitionAt >= 0 ? sentences(item.slice(competitionAt, competitionAt + 1600), 4) : ""
  const programmatic = sentenceAround(item, "programmatic")
  const definedAt = plain.indexOf("Segment Adjusted EBITDA is calculated")
  const ebitdaDefinition = definedAt >= 0 ? sentences(plain.slice(definedAt, definedAt + 500), 2) : ""

  return {
    lines,
    overview: sentences(item, 4),
    competition,
    programmatic,
    ebitdaDefinition,
    rivals: rivalsIn(competition),
  }
}

/** The first real sentence of the business section. Used at the top of a report, before any score. */
export function readOverview(html: string): string {
  const plain = htmlToText(html).replace(/[•●▪◦]/g, " ")
  const item = readItem(plain)
  const parts = item
    .split(/(?<=\.)\s+/)
    .map((part) => part.replace(/^(company background|business overview|overview)\s+/i, "").replace(/\s+/g, " ").trim())
    .filter((part) => {
      if (part.length < 40 || part.length > 420) return false
      if (/^(products|services|competition|item)\b/i.test(part)) return false
      if (/®/.test(part.slice(0, 90))) return false
      if (/fiscal year is the 52-/i.test(part)) return false
      return /\b(is|are|was|were|designs|manufactures|operates|provides|sells|develops|owns|has|have|makes|offers)\b/i.test(part)
    })
  return parts[0] ?? ""
}

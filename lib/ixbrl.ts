import { htmlToText, sentenceAround, sentences, splitSentences } from "./plain"

export type SegmentLine = {
  segment: string
  product: string | null
  year: number
  /** ISO currency of the tagged figures. A renminbi line is not a dollar line. */
  currency: string
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
  /** Sentences from the MD&A that say why a category's sales moved. */
  drivers: string[]
  competitiveFactors: string
}

type Member = { dimension: string; name: string }
type Kind = "revenue" | "ebitda" | "direct" | "sga"

function localName(value: string): string {
  return value.split(":").pop() || value
}

function words(member: string): string {
  const stem = localName(member)
    .replace(/SegmentsMember$/, "")
    .replace(/GroupSegmentMember$/, "")
    .replace(/SegmentMember$/, "")
    .replace(/Member$/, "")
  return stem
    .replace(/([a-z])(E-)/g, "$1 $2")
    .replace(/^IPhone$/, "iPhone")
    .replace(/^IPad$/, "iPad")
    .replace(/([a-z])and(?=[A-Z])/g, "$1 and ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bNon (GAAP|Interest|Operating|Cash|Current)\b/g, "excluding $1")
    .replace(/\bAnd\b/g, "and")
    .replace(/ excluding (\w+)/, (_, word: string) => `, excluding ${word.toLowerCase()}`)
    .replace(/and([A-Z])/g, "and $1")
    .replace(/^I([A-Z])/, "i$1")
    .replace(/\bi Phone\b/g, "iPhone")
    .replace(/\bi Pad\b/g, "iPad")
    .replace(/\bThree Six Five\b/g, "365")
    .replace(/\bLinked In\b/g, "LinkedIn")
    .replace(/\bYou Tube\b/g, "YouTube")
    .replace(/\bPay Pal\b/g, "PayPal")
    .replace(/\bGit Hub\b/g, "GitHub")
    .replace(/\bMc Lane\b/g, "McLane")
    .replace(/\bSams\b/g, "Sam's")
    .replace(/\bA\.Pacific\b/g, "Asia Pacific")
    .replace(/\s+/g, " ")
    .trim()
}

function annualSpan(start: string, end: string): boolean {
  const days = (Date.parse(end) - Date.parse(start)) / 86400000
  return Number.isFinite(days) && days >= 330 && days <= 400
}

function kindOf(name: string): { kind: Kind; rank: number; ebitdaLabel: string | null } | null {
  const local = localName(name)
  if (local === "Revenues" || local === "RevenuesNetOfInterestExpense") return { kind: "revenue", rank: 3, ebitdaLabel: null }
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
  if (/OperatingIncomeLoss/.test(local)) {
    const shared = /ExcludingUnallocated/.test(local)
    return {
      kind: "ebitda",
      rank: shared ? 2 : 1,
      ebitdaLabel: shared ? "Operating income before shared costs" : "Operating income",
    }
  }
  if (/AdjustedEBITA|EarningsBeforeInterestTaxesAndAmortization$/i.test(local) && !/Depreciation/.test(local)) {
    return { kind: "ebitda", rank: 2, ebitdaLabel: "Adjusted EBITA" }
  }
  if (/(?:Earnings|EBIT).*InterestAndTaxesAdjusted$/i.test(local)) {
    return { kind: "ebitda", rank: 2, ebitdaLabel: "Adjusted EBIT" }
  }
  if (local === "EarningsBeforeInterestAndTax" || local === "EarningsBeforeInterestAndTaxes") {
    return { kind: "ebitda", rank: 0, ebitdaLabel: "EBIT" }
  }
  if (local === "Contribution") return { kind: "ebitda", rank: 0, ebitdaLabel: "Contribution" }
  if (local === "GrossProfit") return { kind: "ebitda", rank: -1, ebitdaLabel: "Gross profit" }
  if (
    local === "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest" ||
    local === "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"
  ) {
    return { kind: "ebitda", rank: 0, ebitdaLabel: "Pretax income" }
  }
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
  const dimension = localName(member.dimension)
  if (/ProductOrServiceAxis|StatementGeographicalAxis|ConsolidationItemsAxis/.test(dimension)) return false
  if (isSkipped(member)) return false
  if (/SegmentMember$/.test(name) && !/^(OperatingSegments|ReportableSegments|Segments)Member$/.test(name)) return true
  return dimension === "StatementBusinessSegmentsAxis" && /Member$/.test(name)
}

/** A subsegment is the line. The parent brand on the same fact is the rollup. */
function pickSegment(members: Member[]): Member | undefined {
  const found = members.filter(isSegmentMember)
  return found.find((member) => /SubsegmentsAxis$/.test(localName(member.dimension)))
    ?? found.find((member) => localName(member.dimension) === "StatementBusinessSegmentsAxis")
    ?? found[0]
}

function isChannel(member: Member): boolean {
  return /SalesChannelAxis/.test(member.dimension)
}

function channelLabel(member: Member): string {
  const name = localName(member.name)
  if (/DirectlyToConsumer/.test(name)) return "Direct to consumer"
  if (/ThroughIntermediary|Wholesale/.test(name)) return "Wholesale"
  return words(member.name)
}

function closeMoney(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1)
  return Math.abs(a - b) / scale <= 0.015
}

/** A parent total, or the same segment tagged under two names, is not a second business. */
function withoutRollups(lines: SegmentLine[], parents: Set<string>): SegmentLine[] {
  const drop = new Set<SegmentLine>()
  const years = new Set(lines.map((line) => line.year))
  for (const year of years) {
    const rows = lines.filter((line) => line.year === year && line.product == null && (line.revenue ?? 0) > 0)
    for (const candidate of rows) {
      if (parents.has(candidate.segment) || /excluding/i.test(candidate.segment)) {
        drop.add(candidate)
        continue
      }
      const covered = rows.filter((other) => other !== candidate && other.segment.length > 3 && candidate.segment.includes(other.segment))
      if (covered.length >= 2) drop.add(candidate)
    }
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const left = rows[i]
        const right = rows[j]
        if (left.currency !== right.currency || left.revenue == null || right.revenue == null) continue
        if (!closeMoney(left.revenue, right.revenue)) continue
        const longer = left.segment.length >= right.segment.length ? left : right
        const shorter = longer === left ? right : left
        if (!longer.segment.includes(shorter.segment)) continue
        if (shorter.ebitda == null && longer.ebitda != null) {
          shorter.ebitda = longer.ebitda
          shorter.ebitdaLabel = longer.ebitdaLabel
        }
        drop.add(longer)
      }
    }
  }
  return lines.filter((line) => !drop.has(line))
}

/** Two tagged cuts of one segment are the same sales. Keep the cut that adds up to the segment. */
function withoutDoubleCuts(lines: SegmentLine[]): SegmentLine[] {
  const drop = new Set<SegmentLine>()
  const groups = new Map<string, SegmentLine[]>()
  for (const line of lines) {
    if (!line.product || (line.revenue ?? 0) <= 0) continue
    if (line.segment === "Category" || line.segment === "Rollup" || line.segment === "Channel") continue
    const key = `${line.year}|${line.segment}|${line.currency}`
    const list = groups.get(key) ?? []
    list.push(line)
    groups.set(key, list)
  }
  for (const [key, products] of groups) {
    const [year, segment, currency] = key.split("|")
    const parent = lines.find((line) => line.product == null && String(line.year) === year && line.segment === segment && line.currency === currency)
    if ((parent?.revenue ?? 0) <= 0) continue
    const sum = products.reduce((total, line) => total + (line.revenue ?? 0), 0)
    if (sum <= parent!.revenue! * 1.5) continue
    const keep = largestCut(products, parent!.revenue!)
    if (!keep) continue
    for (const line of products) if (!keep.has(line)) drop.add(line)
  }
  return lines.filter((line) => !drop.has(line))
}

function largestCut(products: SegmentLine[], target: number): Set<SegmentLine> | null {
  if (products.length < 2 || products.length > 40) return null
  const values = products.map((line) => line.revenue ?? 0)
  const leftN = Math.floor(values.length / 2)
  const rightN = values.length - leftN
  const subsets = (start: number, count: number) => {
    const out: { sum: number; mask: number; count: number }[] = []
    for (let mask = 0; mask < (1 << count); mask++) {
      let sum = 0
      let bits = 0
      for (let i = 0; i < count; i++) {
        if ((mask & (1 << i)) === 0) continue
        sum += values[start + i]
        bits += 1
      }
      out.push({ sum, mask, count: bits })
    }
    out.sort((a, b) => a.sum - b.sum)
    return out
  }
  const left = subsets(0, leftN)
  const right = subsets(leftN, rightN)
  let bestGap = Infinity
  let bestCount = -1
  let bestLeft = 0
  let bestRight = 0
  for (const item of right) {
    const want = target - item.sum
    let lo = 0
    let hi = left.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (left[mid].sum < want) lo = mid + 1
      else hi = mid
    }
    for (const index of [lo - 1, lo]) {
      if (index < 0 || index >= left.length) continue
      const sum = left[index].sum + item.sum
      const gap = Math.abs(sum - target) / target
      const count = left[index].count + item.count
      if (count < 2) continue
      if (gap < bestGap - 1e-9 || (Math.abs(gap - bestGap) <= 0.001 && count > bestCount)) {
        bestGap = gap
        bestCount = count
        bestLeft = left[index].mask
        bestRight = item.mask
      }
    }
  }
  if (bestCount < 2 || bestGap > 0.015) return null
  const keep = new Set<SegmentLine>()
  for (let i = 0; i < leftN; i++) if (bestLeft & (1 << i)) keep.add(products[i])
  for (let i = 0; i < rightN; i++) if (bestRight & (1 << i)) keep.add(products[leftN + i])
  return keep.size === products.length ? null : keep
}

function isSkipped(member: Member): boolean {
  return /Intersegment|Elimination|Corporate|Reconciling|SingleReportable|Aggregation|(^|[a-z])Total[A-Z]|TotalSegment|^ReportableSegmentMember$/.test(localName(member.name))
}

function isProduct(member: Member): boolean {
  if (isSegmentMember(member) || isSkipped(member)) return false
  return /ProductOrServiceAxis/.test(member.dimension)
}

function isRollup(member: Member): boolean {
  const name = localName(member.name)
  return name === "ProductMember" || name === "ServiceMember"
}

function productLabel(member: Member): string {
  const word = words(member.name)
  if (word === "Product") return "Products"
  if (word === "Service") return "Services"
  return word
}

type Slot = {
  segment: string
  product: string | null
  year: number
  currency: string
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
  let end = -1
  for (const match of trimmed.matchAll(/\bitem\s+1a\b/gi)) {
    const at = match.index ?? 0
    const before = trimmed.slice(Math.max(0, at - 70), at).toLowerCase()
    if (/refer to|see\b|part i,|described in|discussed in|included in|set forth in/.test(before)) continue
    const after = trimmed.slice(at, at + 36).toLowerCase()
    if (!/risk/.test(after)) continue
    end = at
    break
  }
  if (end > 500) return trimmed.slice(0, end).trim()
  return trimmed.slice(0, 20000).trim()
}

function readItem(plain: string): string {
  const pattern = /item\s+1\.?\s+business|item\s+4\.?\s+inform\s*ation on the company/gi
  let bestAt = -1
  let bestScore = 0
  for (const match of plain.matchAll(pattern)) {
    const at = match.index ?? 0
    const before = plain.slice(Math.max(0, at - 60), at)
    const after = plain.slice(at + match[0].length, at + match[0].length + 320)
    if (/\b(see|refer|under|caption|discussion|described|included|pursuant)\b/i.test(before)) continue
    if (/^\s*[.·]\s*\d/.test(after)) continue
    if (/^\s*[–—\-]/.test(after)) continue
    if (/^\s*,\s*[”"']/.test(after)) continue
    if (/^\s*["“”']?\s*above\b/i.test(after)) continue
    if (/^\s*[”"']/.test(after)) continue
    if (/^\s*of this report\b/i.test(after)) continue
    if (/^\s*(item|part|see|under)\b/i.test(after)) continue
    if (looksLikeContents(after)) continue
    const score = (after.match(/[a-z]/g) || []).length
    if (score > bestScore) {
      bestScore = score
      bestAt = (match.index ?? 0) + match[0].length
    }
  }
  if (bestAt >= 0 && bestScore >= 40) return clipItem(plain.slice(bestAt))

  const token = "[A-Z][A-Za-z0-9&'’\\-]*[A-Za-z0-9]|[a-z]+[A-Z][A-Za-z0-9&'’\\-]*[A-Za-z0-9]"
  const named = new RegExp(
    `\\b(?!(?:Business|General|Item|Overview|Part|Table|Inc|Corp|Ltd|LLC|Company)\\b)((?:The Company|(?:${token})(?:\\s+(?!(?:Business|General|Item|Overview)\\b)(?:${token})){0,4})\\.?\\s+is an?\\s+[^.]{40,280}\\.)`,
    "g",
  )
  for (const match of plain.matchAll(named)) {
    const at = match.index ?? 0
    if (at < 1500 || at > 120000) continue
    const before = plain.slice(Math.max(0, at - 80), at)
    if (/table of contents|item\s+1a/i.test(before)) continue
    return clipItem(plain.slice(at))
  }

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

function sectionAt(text: string, pattern: RegExp): number {
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    const after = text.slice(at, at + 180)
    if (/\btable of contents\b/i.test(after) || looksLikeContents(after)) continue
    return at
  }
  return -1
}

function rivalsIn(competition: string): string[] {
  const found = new Set<string>()
  const pattern = /\b([A-Z][A-Za-z&.'’-]+(?:\s+[A-Z][A-Za-z&.'’-]+){0,3})\s+(Inc\.|Corp\.|Corporation|LLC|Ltd\.|Co\.)/g
  for (const match of competition.matchAll(pattern)) {
    const name = `${match[1]} ${match[2]}`.replace(/\s+/g, " ").replace(/^(?:Table of )?Contents\s+/i, "")
    if (/^(The|Our|Item|Part|United|Federal|Commission|Company|Securities|Contents|Table|See)\b/.test(name)) continue
    found.add(name)
    if (found.size >= 8) break
  }
  return [...found]
}

function factCurrency(measure: string | undefined): string | null {
  if (!measure) return null
  if (/shares/i.test(measure)) return null
  return measure.match(/iso4217:([A-Z]{3})/)?.[1] ?? null
}

export function readAnnual(html: string): AnnualRead {
  const units = new Map<string, string>()
  for (const match of html.matchAll(/<xbrli:unit id="([^"]+)">([\s\S]*?)<\/xbrli:unit>/g)) {
    const measure = [...match[2].matchAll(/<xbrli:measure>([^<]+)<\/xbrli:measure>/g)].map((item) => item[1]).join(" ")
    units.set(match[1], measure)
  }
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
  const parents = new Set<string>()
  for (const match of html.matchAll(/<ix:nonFraction\b([^>]*)>([^<]*)<\/ix:nonFraction>/g)) {
    const fact = attrs(match[1])
    const context = contexts.get(fact.contextRef || "")
    const meta = kindOf(fact.name || "")
    if (!context || !meta) continue
    if (context.members.some(isSkipped)) continue
    const segmentMember = pickSegment(context.members)
    if (segmentMember) {
      for (const other of context.members) {
        if (other !== segmentMember && isSegmentMember(other)) parents.add(words(other.name))
      }
    }
    const productMember = context.members.find(isProduct)
    const channelMember = context.members.find(isChannel)
    if (!segmentMember && !productMember && !channelMember) continue
    const sliced = segmentMember && !productMember && !channelMember && context.members.some((member) => {
      if (member === segmentMember || isSegmentMember(member)) return false
      return localName(member.name) !== "OperatingSegmentsMember"
    })
    if (sliced) continue
    const value = amount(match[2], fact.scale, fact.sign)
    if (value == null) continue
    const tagged = factCurrency(units.get(fact.unitRef || ""))
    if (units.has(fact.unitRef || "") && tagged == null) continue
    const currency = tagged ?? "USD"
    const year = Number(context.end.slice(0, 4))
    const segment = segmentMember
      ? words(segmentMember.name)
      : channelMember
        ? "Channel"
        : isRollup(productMember!) ? "Rollup" : "Category"
    const product = segmentMember
      ? (productMember ? productLabel(productMember) : null)
      : channelMember
        ? channelLabel(channelMember)
        : productLabel(productMember!)
    const key = `${year}|${segment}|${product ?? ""}`
    const existing = slots.get(key)
    if (existing && existing.currency !== currency) continue
    const slot = existing ?? {
      segment,
      product,
      year,
      currency,
      revenue: null,
      revenueRank: 0,
      ebitda: null,
      ebitdaRank: -1,
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

  const lines: SegmentLine[] = withoutDoubleCuts(withoutRollups([...slots.values()]
    .filter((slot) => (slot.revenue ?? 0) > 0 || (slot.ebitda ?? 0) !== 0)
    .map((slot) => ({
      segment: slot.segment,
      product: slot.product,
      year: slot.year,
      currency: slot.currency,
      revenue: slot.revenue,
      ebitda: slot.ebitda,
      ebitdaLabel: slot.ebitdaLabel,
      direct: slot.direct,
      sga: slot.sga,
    })), parents))

  const plain = htmlToText(html)
  const item = readItem(plain)
  const competitionAt = sectionAt(item, /\bCompetition\b/g)
  const competition = competitionAt >= 0 ? sentences(item.slice(competitionAt, competitionAt + 1800), 5) : ""
  const factorsAt = item.search(/principal competitive factors/i)
  const competitiveFactors = factorsAt >= 0 ? sentences(item.slice(Math.max(0, factorsAt - 20), factorsAt + 500), 2) : ""
  const programmatic = sentenceAround(item, "programmatic")
  const definedAt = plain.indexOf("Segment Adjusted EBITDA is calculated")
  const ebitdaDefinition = definedAt >= 0 ? sentences(plain.slice(definedAt, definedAt + 500), 2) : ""

  return {
    lines,
    overview: businessSentences(item, 2) || sentences(item, 2),
    competition,
    programmatic,
    ebitdaDefinition,
    rivals: rivalsIn(competition),
    drivers: categoryDrivers(plain),
    competitiveFactors,
  }
}

function businessBody(item: string): string {
  const match = /\bbusiness overview\b(?!\s*[–—\-])/i.exec(item)
  if (match && item.length - match.index > 200) return item.slice(match.index)
  return item
}

function stripHeading(part: string): string {
  let text = part.replace(/\s+/g, " ").trim()
  for (let i = 0; i < 5; i++) {
    const next = text
      .replace(/^(?:[A-D]\.\s+)?(?:history and development of the company|business overview|corporate information|corporate history|our mission and vision|our history and structure|company background|about the company|overview)\s+/i, "")
      .replace(/^(?:(?:item\s+1|business)\s+)+/i, "")
      .replace(/^(?:GENERAL\s+)+/, "")
      .replace(/^general\s+(?!motors\b)/i, "")
      .trim()
    if (next === text) break
    text = next
  }
  return text
    .replace(/^(?:[A-Z]{2,}\s+)+(?=(?!Inc\b|Corp\b|Co\b|Ltd\b|LLC\b|Company\b|Group\b|Holdings\b|Limited\b|Corporation\b|Motors\b)[A-Z][a-z])/, "")
    .replace(/^((?:\S+\s+){1,4})(\1)/i, "$2")
    .trim()
}

function isCharter(part: string): boolean {
  if (/we acquired the business|had been incorporated|we were incorporated|registered office|principal executive offices|website address|incorporated by reference|inactive textual references|our telephone number|originally organized|was reorganized as|as used herein|unless designated or identified otherwise/i.test(part)) {
    return true
  }
  if (!/was incorporated/i.test(part)) return false
  return !/\b(designs|manufactures|operates|provides|sells|serves|develops|offers|leading|manufacturer|retailer)\b/i.test(part)
}

function isIndex(part: string): boolean {
  return (part.match(/\b\d{1,3}\b/g)?.length ?? 0) >= 4
}

function unquoted(part: string): string {
  let text = part.replace(/"[^"]*"/g, " ").replace(/[“][^”]*[”]/g, " ")
  const marks = text.match(/"/g)?.length ?? 0
  if (marks % 2 === 1) {
    const at = text.indexOf('"')
    text = text.slice(0, at)
  }
  return text.replace(/\s+/g, " ").trim()
}

function businessSentences(item: string, count: number): string {
  const parts = splitSentences(businessBody(item))
    .map(stripHeading)
    .filter((part) => {
      if (part.length < 40 || part.length > 480) return false
      if (isCharter(part) || isIndex(part)) return false
      if (/founders' letter|not a conventional company/i.test(part)) return false
      if (/^(products|services|competition|item)\b/i.test(part)) return false
      if (/®/.test(part.slice(0, 90))) return false
      if (/registered trademark|service mark|used herein with permission/i.test(part)) return false
      if (/fiscal year is the 52-/i.test(part)) return false
      const bare = unquoted(part)
      if (bare.length < 40) return false
      return /\b(is|are|was|were|designs?|manufactures?|operates?|provides?|sells?|serves?|seeks?|develops?|owns?|has|have|makes?|offers?|builds?)\b/i.test(bare)
    })
  return parts.slice(0, count).join(" ")
}

function categoryDrivers(plain: string): string[] {
  const at = plain.search(/net sales by category/i)
  if (at < 0) return []
  const window = plain.slice(at, at + 2400)
  return splitSentences(window)
    .map((part) => part.replace(/\s+/g, " ").trim().replace(/^(\S+)\s+\1\b/i, "$1"))
    .filter((part) => /net sales (increased|decreased|were|was)/i.test(part) && part.length < 320)
    .slice(0, 6)
}

const BORROWING_LINES: Record<string, string> = {
  SeniorLongTermNotes: "senior notes",
  ConvertibleDebtNoncurrent: "convertible notes",
  LongTermLoansFromBank: "non-current bank loans",
  BankBorrowingsCurrent: "current bank loans",
  NonCurrentExchangeableBonds: "exchangeable bonds",
}

const INVESTMENT_LINES = [
  "ShortTermInvestments",
  "ShortTermInvestmentsBankTimeDepositsAndOtherShortTermInvestments",
  "MarketableSecuritiesCurrent",
]

/** Short-term investments in USD on the statement, when the filing feed only has them in another currency. */
export function statedInvestments(html: string, anchor: string | null): number | null {
  if (!html || !anchor) return null
  const plain = new Set<string>()
  for (const match of html.matchAll(/<xbrli:context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/g)) {
    const body = match[2] ?? ""
    if (/<xbrldi:explicitMember\b/.test(body)) continue
    const instant = body.match(/<xbrli:instant>([^<]+)<\/xbrli:instant>/)
    if (instant?.[1] === anchor) plain.add(match[1])
  }
  if (!plain.size) return null
  const usd = new Set<string>()
  for (const match of html.matchAll(/<xbrli:unit\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:unit>/g)) {
    const measure = match[2] ?? ""
    if (/iso4217:USD</.test(measure) && !/iso4217:[A-Z]{3}</.test(measure.replace("iso4217:USD", ""))) usd.add(match[1])
  }
  const found = new Map<string, number>()
  for (const match of html.matchAll(/<ix:nonFraction\b([^>]*)>([^<]*)<\/ix:nonFraction>/g)) {
    const attrs = match[1] ?? ""
    const name = attrs.match(/\bname="[^"]*:([^"]+)"/)?.[1]
    if (!name || !INVESTMENT_LINES.includes(name)) continue
    const context = attrs.match(/\bcontextRef="([^"]+)"/)?.[1]
    const unit = attrs.match(/\bunitRef="([^"]+)"/)?.[1]
    if (!context || !plain.has(context) || !unit || !usd.has(unit)) continue
    const scale = Number(attrs.match(/\bscale="(-?\d+)"/)?.[1] ?? "0")
    const value = Number((match[2] ?? "").replace(/,/g, ""))
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(scale)) continue
    const amount = value * 10 ** scale
    const prior = found.get(name)
    if (prior != null && Math.abs(prior - amount) / Math.max(prior, amount) > 0.02) return null
    found.set(name, amount)
  }
  for (const name of INVESTMENT_LINES) {
    const amount = found.get(name)
    if (amount != null) return amount
  }
  return null
}

/** Borrowings the filing states as separate lines when it never tags one total. */
export function instrumentBorrowings(html: string, anchor: string | null): { total: number; lines: string[] } | null {
  if (!html || !anchor) return null
  const plain = new Set<string>()
  const contextRe = /<xbrli:context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/g
  for (const match of html.matchAll(contextRe)) {
    const body = match[2] ?? ""
    if (/<xbrldi:explicitMember\b/.test(body)) continue
    const instant = body.match(/<xbrli:instant>([^<]+)<\/xbrli:instant>/)
    if (instant?.[1] === anchor) plain.add(match[1])
  }
  if (!plain.size) return null
  const usd = new Set<string>()
  const unitRe = /<xbrli:unit\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:unit>/g
  for (const match of html.matchAll(unitRe)) {
    const measure = match[2] ?? ""
    if (/iso4217:USD</.test(measure) && !/iso4217:[A-Z]{3}</.test(measure.replace("iso4217:USD", ""))) usd.add(match[1])
  }
  const found = new Map<string, number>()
  const factRe = /<ix:nonFraction\b([^>]*)>([^<]*)<\/ix:nonFraction>/g
  for (const match of html.matchAll(factRe)) {
    const attrs = match[1] ?? ""
    const name = attrs.match(/\bname="[^"]*:([^"]+)"/)?.[1]
    const label = name ? BORROWING_LINES[name] : undefined
    if (!label) continue
    const context = attrs.match(/\bcontextRef="([^"]+)"/)?.[1]
    const unit = attrs.match(/\bunitRef="([^"]+)"/)?.[1]
    if (!context || !plain.has(context) || !unit || !usd.has(unit)) continue
    const scale = Number(attrs.match(/\bscale="(-?\d+)"/)?.[1] ?? "0")
    const value = Number((match[2] ?? "").replace(/,/g, ""))
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(scale)) continue
    const amount = value * 10 ** scale
    const prior = found.get(label)
    if (prior != null && Math.abs(prior - amount) / Math.max(prior, amount) > 0.02) return null
    found.set(label, amount)
  }
  if (!found.size) return null
  const total = [...found.values()].reduce((sum, amount) => sum + amount, 0)
  return total > 0 ? { total, lines: [...found.keys()] } : null
}

/** The first real sentence of the business section. Used at the top of a report, before any score. */
export function readOverview(html: string): string {
  const plain = htmlToText(html).replace(/[•●▪◦]/g, " ")
  const item = readItem(plain)
  return businessSentences(item, 1)
}

import { splitSentences } from "./plain"
import type { Submissions } from "./sec"

const DAY = 86400000
const REGISTRATION = /^(?:S-1|F-1)(?:\/A)?$/
const ANNUAL = /^(?:10-K|20-F|40-F)(?:\/A)?$/

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  eight: 8,
  ten: 10,
  twenty: 20,
  fifty: 50,
  hundred: 100,
}

export type FirstListing = {
  form: string
  filed: string
  prospectusFiled: string | null
}

export type Offering = {
  sold: number
  extra: number
  /** Ordinary shares, or ADSs times ordinary shares per ADS. Null when an ADS offering does not state the ratio. */
  ordinary: number | null
  unit: "ADS" | "share"
  price: number | null
}

export type CustomerStake = {
  name: string
  share: number
}

/** The earliest S-1 or F-1 in the recent filings, when no annual report predates it by half a year. */
export function firstListing(submissions: Submissions | null, now = Date.now()): FirstListing | null {
  const recent = submissions?.filings?.recent
  if (!recent?.form?.length) return null
  let registration: { form: string; filed: string } | null = null
  let prospectus: string | null = null
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i] ?? ""
    const filed = recent.filingDate?.[i]
    if (!filed) continue
    if (REGISTRATION.test(form) && (!registration || filed < registration.filed)) {
      registration = { form, filed }
    }
    if (form === "424B4" && (!prospectus || filed > prospectus)) prospectus = filed
  }
  if (!registration) return null
  const filedAt = Date.parse(registration.filed)
  if (!Number.isFinite(filedAt) || now < filedAt || now - filedAt > 730 * DAY) return null
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i] ?? ""
    const filed = recent.filingDate?.[i]
    if (!filed || !ANNUAL.test(form)) continue
    const annualAt = Date.parse(filed)
    if (Number.isFinite(annualAt) && filedAt - annualAt > 180 * DAY) return null
  }
  const prospectusFiled = prospectus && prospectus >= registration.filed ? prospectus : null
  return { form: registration.form, filed: registration.filed, prospectusFiled }
}

function parseCount(raw: string): number | null {
  const value = Number(raw.replace(/,/g, ""))
  return Number.isFinite(value) && value >= 1000 ? value : null
}

function parseRatio(raw: string): number | null {
  const word = NUMBER_WORDS[raw.toLowerCase()]
  if (word) return word
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 && value <= 1000 ? value : null
}

function offeringPrice(text: string): number | null {
  const match = text.match(
    /(?:priced at|at a price of|public offering price of|offering price of(?: the ADSs is)?)\s+\$(\d+(?:\.\d+)?)(?:\s*per\s+(?:ADS|share))?/i,
  )
  if (!match) return null
  const value = Number(match[1])
  return value >= 0.5 && value <= 500 ? value : null
}

function shareRatio(text: string): number | null {
  const match = text.match(
    /each (?:ADS|American depositary share) represents ([a-z]+|\d+(?:\.\d+)?) ordinary shares?|each representing ([a-z]+|\d+(?:\.\d+)?) ordinary shares?/i,
  )
  const raw = match?.[1] ?? match?.[2]
  return raw ? parseRatio(raw) : null
}

/** The offering price, or the high since the listing, once the quote is half of it or less. */
export function halvedQuote(
  listing: FirstListing,
  price: number | null,
  history: { date: string; close: number }[],
  offeringPrice: number | null,
): { from: number; kind: "offering" | "high" } | null {
  if (price == null || price <= 0) return null
  if (offeringPrice != null && offeringPrice > 0) {
    return price <= offeringPrice * 0.5 ? { from: offeringPrice, kind: "offering" } : null
  }
  const start = Date.parse(listing.filed)
  const sorted = history
    .filter((point) => {
      const at = Date.parse(point.date)
      return Number.isFinite(at) && at >= start - 45 * DAY
    })
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!sorted.length || Date.parse(sorted[0].date) - start > 120 * DAY) return null
  const high = Math.max(...sorted.map((point) => point.close))
  return high > 0 && price <= high * 0.5 ? { from: high, kind: "high" } : null
}

/** Shares sold in the first offering, from the phrases the prospectus and the annual report both use. */
export function readOffering(text: string): Offering | null {
  const sold = /(?:IPO of|issued and sold|we issued)\s+([\d,]{4,})\s+(ADSs|American Depositary Shares|ordinary shares|shares of (?:our |the )?common stock)/i.exec(text)
  if (!sold) return null
  const count = parseCount(sold[1])
  if (count == null) return null
  const ads = /^ADS/i.test(sold[2])
  const ratio = ads ? shareRatio(text) : 1
  const extraMatch = /(?:in full to purchase the additional|sale of an additional|to purchase an additional)\s+([\d,]{4,})\s+ADSs/i.exec(text)
  const extraRaw = extraMatch ? parseCount(extraMatch[1]) : null
  const extra = extraRaw != null && extraRaw <= count * 0.2 ? extraRaw : 0
  return {
    sold: count,
    extra,
    ordinary: ratio == null ? null : (count + extra) * ratio,
    unit: ads ? "ADS" : "share",
    price: offeringPrice(text),
  }
}

const SKIP_NAME = /^(?:Other|Total|Subtotal|Revenue|Customer|Customers|Amount|Percentage|Fiscal|Net|Sales|The|Our|Including|Include|Group|Table|Contents|Item|During|There|Below|For|And)$/i

function cleanName(raw: string): string | null {
  const name = raw.replace(/\*+$/g, "").replace(/\s+/g, " ").trim()
  if (name.length < 3 || name.length > 48 || SKIP_NAME.test(name)) return null
  if (/revenue|percentage|amount|fiscal/i.test(name)) return null
  if (/^(?:United States|U\.S|USA|China|Japan|Korea|South Korea|North Korea|Europe|Americas|America|Asia|Canada|Mexico|Germany|India|Taiwan|Thailand|Australia|Brazil|France|Italy|Spain|United Kingdom|U\.K|Greater China|International|Domestic|Overseas|EMEA|APAC)$/i.test(name)) return null
  if (!/^[A-Z]/.test(name)) return null
  return name
}

function pushStake(stakes: CustomerStake[], name: string | null, percent: number) {
  if (!name || percent < 10 || percent > 100) return
  if (stakes.some((stake) => stake.name === name)) return
  stakes.push({ name, share: percent / 100 })
}

function tableCustomers(text: string): CustomerStake[] {
  const header = text.search(/Percentage of Total Revenue/i)
  if (header < 0) return []
  const at = header + "Percentage of Total Revenue".length
  const rest = text.slice(at, at + 1400)
  const stop = rest.search(/\*\s*Include\b|\bFiscal year ended\b/i)
  const block = stop > 40 ? rest.slice(0, stop) : rest
  const row = /([A-Z][A-Za-z0-9&.'’\-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'’\-]{1,40}){0,3})\*?\s+(?:JPY|US\$|USD|\$)[\d,]+(?:\s*\([^)]{0,140}\))?\s*;?\s*(\d{1,3}(?:\.\d+)?)\s*%/g
  const stakes: CustomerStake[] = []
  for (const match of block.matchAll(row)) {
    pushStake(stakes, cleanName(match[1]), Number(match[2]))
  }
  return stakes
}

function listCustomers(sentence: string): CustomerStake[] {
  const match = /([A-Z][\sA-Za-z0-9&.'’,\-]{0,180}?)\s+representing\s+((?:\d{1,2}(?:\.\d+)?%\s*(?:,|and)\s*)+\d{1,2}(?:\.\d+)?%)\s+of (?:our )?(?:total )?(?:revenue|net sales)/i.exec(sentence)
  if (!match) return []
  const names = match[1]
    .replace(/^.*\b(?:customers?|clients?)\b[^A-Z]*/i, "")
    .split(/,|\band\b/)
    .map((part) => cleanName(part))
  const percents = [...match[2].matchAll(/(\d{1,2}(?:\.\d+)?)%/g)].map((part) => Number(part[1]))
  if (names.length !== percents.length || names.some((name) => !name)) return []
  const stakes: CustomerStake[] = []
  names.forEach((name, index) => pushStake(stakes, name, percents[index]))
  return stakes
}

function namedCustomers(sentence: string): CustomerStake[] {
  const stakes: CustomerStake[] = []
  const named = /([A-Z][A-Za-z0-9&.'’\-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'’\-]{1,40}){0,3}) (?:accounted for|represented) (?:approximately )?(\d{1,2}(?:\.\d+)?)%/g
  for (const match of sentence.matchAll(named)) {
    const before = sentence.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0).toLowerCase()
    if (/(?:\bin|\bof the|\boutside|\bwithin|\bacross)\s+$/.test(before)) continue
    pushStake(stakes, cleanName(match[1]), Number(match[2]))
  }
  return stakes
}

/** Customers the annual report itself puts above a tenth of revenue. Latest table wins. */
export function readCustomers(text: string): CustomerStake[] {
  const table = tableCustomers(text)
  if (table.length) return table.slice(0, 4)
  const stakes: CustomerStake[] = []
  for (const sentence of splitSentences(text)) {
    if (!/customer/i.test(sentence)) continue
    if (/no (?:single |one )?customer/i.test(sentence)) continue
    if (/\b(segment|geographic|geographical|region|country)\b/i.test(sentence)) continue
    for (const stake of [...listCustomers(sentence), ...namedCustomers(sentence)]) {
      pushStake(stakes, stake.name, stake.share * 100)
    }
  }
  return stakes.slice(0, 4)
}

export function customersOwnShares(text: string, names: string[]): boolean {
  const heads = names.map((name) => name.split(/\s+/)[0]).filter((head) => head.length > 2)
  return splitSentences(text).some((sentence) => {
    if (!/are also our shareholders|both significant customer and significant shareholder/i.test(sentence)) return false
    return /customer/i.test(sentence) || heads.some((head) => sentence.includes(head))
  })
}

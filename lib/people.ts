import { htmlToText, sentences } from "./plain"

export type Officer = {
  name: string
  age: number | null
  role: string
  since: string | null
  salary: number | null
  equityPay: number | null
  incentive: number | null
  totalPay: number | null
  shares: number | null
  ownership: string | null
  bio: string | null
}

export type Director = {
  name: string
  since: string
  note: string | null
  bio: string | null
}

export type Holder = {
  name: string
  shares: number
  ownership: string
}

export type PeopleRead = {
  officers: Officer[]
  directors: Director[]
  holders: Holder[]
  groupOwnership: string | null
}

const NAME = "[A-Z][A-Za-z'’\\-]*"
const NOT_NAME = "Principal|Position|Year|Salary|Stock|Awards|Total|Name|Compensation|Incentive|Other|Equity|Plan|All|Non|Summary|Table|Director|Former|Senior|Executive|Vice|Chief|President|General"
const PERSON = `(?!${NOT_NAME}\\b)${NAME}(?:\\s[A-Z]\\.)?\\s(?!${NOT_NAME}\\b)${NAME}`
const NOT_A_NAME = new RegExp(`^(${NOT_NAME})\\b`)
const HONOR = "(?:Mr|Ms|Mrs|Dr)\\."

function dollars(block: string): number[] {
  return [...block.matchAll(/\$\s*([\d,]+)/g)].map((match) => Number(match[1].replace(/,/g, "")))
}

function payParts(amounts: number[]): { salary: number | null; equityPay: number | null; incentive: number | null; totalPay: number | null } {
  if (amounts.length > 6) {
    return { salary: amounts[0], equityPay: null, incentive: null, totalPay: amounts[amounts.length - 1] }
  }
  if (amounts.length === 6) {
    return { salary: amounts[0], equityPay: amounts[2], incentive: amounts[3], totalPay: amounts[5] }
  }
  if (amounts.length >= 5) {
    return { salary: amounts[0], equityPay: amounts[1], incentive: amounts[2], totalPay: amounts[4] }
  }
  if (amounts.length === 4) {
    return { salary: amounts[0], equityPay: amounts[1], incentive: amounts[2], totalPay: amounts[3] }
  }
  return { salary: amounts[0] ?? null, equityPay: amounts[1] ?? null, incentive: null, totalPay: amounts[amounts.length - 1] ?? null }
}

/** The compensation row often puts the dollar sign in the column header and bare numbers in the cells. Keep the latest year only. */
function yearAmounts(block: string): number[] {
  const parts = block.split(/\b20\d\d\b/)
  const body = (parts[0].trim() ? parts[0] : parts[1] ?? "").replace(/\(\d+\)/g, " ").replace(/[—–]/g, " 0 ")
  const signed = dollars(body)
  if (signed.length) return signed
  return [...body.matchAll(/\b(0|\d{1,3}(?:,\d{3})+(?:\.\d+)?)\b/g)].map((match) => Number(match[1].replace(/,/g, "")))
}

function lastName(name: string): string {
  return name.split(/\s+/).pop()?.replace(/[.,]/g, "") ?? name
}

function clipBio(raw: string): string | null {
  const cut = raw.split(/\bOther Public Company Boards\b/i)[0]
  const cleaned = cut
    .replace(/\s+\d+\s+20\d\d\s+Proxy Statement[\s\S]*$/i, "")
    .replace(/\s+Table of Contents[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
  if (cleaned.length < 40) return null
  return sentences(cleaned, 2)
}

function firstSentence(text: string, name: string): string | null {
  const was = text.indexOf(`${name} was`)
  const served = text.indexOf(`${name} has served`)
  const at = was >= 0 && served >= 0 ? Math.min(was, served) : Math.max(was, served)
  if (at < 0) return null
  const slice = text.slice(at, at + 700)
  const body = slice.slice(name.length)
  const period = body.search(/[.!?]["”]?\s+(?=[A-Z])/)
  const nextPerson = body.search(new RegExp(`\\s${PERSON}\\s+(?:was|has served)`))
  let stop = period
  if (nextPerson >= 0 && (stop < 0 || nextPerson < stop)) stop = nextPerson
  if (stop < 12) return null
  return slice.slice(0, name.length + stop + 1).trim()
}

export function readPeople(html: string): PeopleRead {
  const text = htmlToText(html)
  const officers: Officer[] = []
  const rosterAt = text.search(/names, ages and positions of our current executive officers/i)
  if (rosterAt >= 0) {
    const roster = text.slice(rosterAt, rosterAt + 1800)
    const row = new RegExp(`(${PERSON})\\s+(\\d{2})\\s+(.{4,120}?)(?=\\s+${PERSON}\\s+\\d{2}\\b|\\s+${PERSON}\\s+was\\b)`, "g")
    for (const match of roster.matchAll(row)) {
      const name = match[1].trim()
      if (officers.some((officer) => officer.name === name)) continue
      if (NOT_A_NAME.test(name)) continue
      officers.push({
        name,
        age: Number(match[2]),
        role: match[3].trim().replace(/\s+/g, " "),
        since: null,
        salary: null,
        equityPay: null,
        incentive: null,
        totalPay: null,
        shares: null,
        ownership: null,
        bio: firstSentence(text, name),
      })
    }
  }

  const payAt = payTableAt(text)
  if (payAt >= 0) {
    const pay = text.slice(payAt, payAt + 7000)
    const row = new RegExp(`(${PERSON})\\s+([^$\\d]{8,180}?)\\s+(20\\d\\d)\\s+([\\s\\S]{8,240}?)(?=\\s+20\\d\\d\\s+(?:\\$|[\\d—–-])|\\s+${PERSON}\\s+)`, "g")
    const seen = new Set<string>()
    for (const match of pay.matchAll(row)) {
      const name = match[1].trim()
      const role = match[2].replace(/\s+/g, " ").trim()
      if (seen.has(name) || NOT_A_NAME.test(name)) continue
      if (!/Chief|President|Officer|Chairman|Vice/.test(role)) continue
      seen.add(name)
      const parts = payParts(yearAmounts(match[4]))
      const existing = officers.find((officer) => officer.name === name)
      if (existing) {
        existing.role = existing.role || role
        existing.salary = parts.salary
        existing.equityPay = parts.equityPay
        existing.incentive = parts.incentive
        existing.totalPay = parts.totalPay
      } else {
        officers.push({
          name,
          age: null,
          role,
          since: null,
          salary: parts.salary,
          equityPay: parts.equityPay,
          incentive: parts.incentive,
          totalPay: parts.totalPay,
          shares: null,
          ownership: null,
          bio: firstSentence(text, name),
        })
      }
    }
  }

  const ownAt = text.indexOf("Named Executive Officers, Directors and Director Nominees")
  let groupOwnership: string | null = null
  if (ownAt >= 0) {
    const own = text.slice(ownAt, ownAt + 1800)
    const row = new RegExp(`(${PERSON})\\s+(?:\\(\\d+\\)\\s+)?([\\d,]{2,})\\s+(?:\\(\\d+\\)\\s+)?(\\d+(?:\\.\\d+)?%|\\*)`, "g")
    for (const match of own.matchAll(row)) {
      const name = match[1].trim()
      const shares = Number(match[2].replace(/,/g, ""))
      const ownership = match[3] === "*" ? "under 1%" : match[3]
      const officer = officers.find((person) => person.name === name)
      if (officer) {
        officer.shares = shares
        officer.ownership = ownership
      }
    }
    const group = own.match(/as a group \([^)]+\)\s+\(\d+\)\s+([\d,]+)\s+(\d+(?:\.\d+)?%)/i)
    if (group) groupOwnership = `${group[2]} of the class, ${Number(group[1].replace(/,/g, "")).toLocaleString("en-US")} shares, officers and directors together`
  }

  const directors: Director[] = []
  const boardAt = text.indexOf("Director Director Since")
  if (boardAt >= 0) {
    const board = text.slice(boardAt, boardAt + 1400).split(/A\s*=\s*Audit/i)[0]
    const row = new RegExp(`(${PERSON})(?:\\s+\\(([^)]{3,80})\\))?\\s+((?:19|20)\\d{2})`, "g")
    for (const match of board.matchAll(row)) {
      const name = match[1].trim()
      if (directors.some((director) => director.name === name) || NOT_A_NAME.test(name)) continue
      directors.push({ name, since: match[3], note: cleanNote(match[2]?.trim() || null), bio: null })
      const officer = officers.find((person) => person.name === name)
      if (officer && !officer.since) officer.since = match[3]
    }
  }

  readCompensationRows(text, officers)
  readOfficerNarratives(text, officers)
  readRoster(text, officers)
  readNameAgePosition(text, officers)
  readPositionBios(text, officers)
  readServedBios(text, officers)
  readPayFollowingTitle(text, officers)
  readDirectorBlocks(text, directors, officers)
  readDirectorRoster(text, directors, officers)
  readDirectorSince(text, directors, officers)
  readCareerBios(text, officers, directors)
  applyOwnership(text, officers)
  const holders = readHolders(text, officers)
  if (!groupOwnership) groupOwnership = readGroup(text)

  officers.sort((a, b) => rankOfficer(a) - rankOfficer(b))
  return {
    officers: officers.slice(0, 12),
    directors: directors.slice(0, 16),
    holders,
    groupOwnership,
  }
}

function rankOfficer(officer: Officer): number {
  if (/^former\b/i.test(officer.role)) return 3
  if (/chief executive/i.test(officer.role)) return 0
  if (/^chief\b/i.test(officer.role)) return 1
  return 2
}

function cleanNote(note: string | null): string | null {
  if (!note) return null
  if (/key skills|table of contents|proxy statement|committee/i.test(note)) return null
  return note.replace(/\s+/g, " ").trim()
}

function upsertOfficer(officers: Officer[], name: string, role: string, age: number | null, bio: string | null) {
  if (NOT_A_NAME.test(name)) return
  const existing = officers.find((officer) => officer.name === name)
  if (existing) {
    if (!existing.role || (role && role.length < existing.role.length && /Chief|President|Officer/.test(role))) existing.role = role
    if (existing.age == null && age != null) existing.age = age
    if (bio && (!existing.bio || bio.length > existing.bio.length)) existing.bio = bio
    return
  }
  officers.push({
    name,
    age,
    role,
    since: null,
    salary: null,
    equityPay: null,
    incentive: null,
    totalPay: null,
    shares: null,
    ownership: null,
    bio,
  })
}

/** "Kate Adams Senior Vice President, General Counsel and Secretary Ms. Adams, 61, oversees…" */
function readOfficerNarratives(text: string, officers: Officer[]) {
  const title = "(?:Former\\s+)?(?:Chief|Senior Vice President|Executive Vice President|Vice President|President|General Counsel|Chairman)[^.]{0,110}?"
  const row = new RegExp(
    `(${PERSON})\\s+(${title})\\s+${HONOR}\\s+[A-Za-z'’\\-]+,\\s+(\\d{2}),\\s+([\\s\\S]{40,900}?)(?=\\s+${PERSON}\\s+(?:Former\\s+)?(?:Chief|Senior|Executive|Vice|President|General|Chairman)|\\s+Executive Compensation|\\s+\\d+\\s+20\\d\\d\\s+Proxy Statement)`,
    "g",
  )
  for (const match of text.matchAll(row)) {
    const name = match[1].trim()
    const role = match[2].replace(/\s+/g, " ").trim().replace(/[,;]$/, "")
    if (!/Chief|President|Officer|Chairman|Counsel|Vice/.test(role)) continue
    upsertOfficer(officers, name, role, Number(match[3]), clipBio(match[4]))
  }
}

function readCareerBios(text: string, officers: Officer[], directors: Director[]) {
  const row = new RegExp(`Career Highlights\\s+${HONOR}\\s+([A-Za-z'’\\-]+),\\s+(\\d{2}),\\s+([\\s\\S]{40,800}?)(?=\\s+Other Public Company|\\s+Key Skills|\\s+${PERSON}\\s+)`, "g")
  for (const match of text.matchAll(row)) {
    const last = match[1]
    const age = Number(match[2])
    const bio = clipBio(match[3])
    const officer = officers.find((person) => lastName(person.name) === last && !person.bio)
    if (officer) {
      officer.bio = bio
      if (officer.age == null) officer.age = age
    }
    const director = directors.find((person) => lastName(person.name) === last)
    if (director && !director.bio) director.bio = bio
  }
}

const DIRECTOR_NAME = `(?:Dr\\.\\s+)?[A-Z][A-Za-z'’\\-]+(?:\\s+[\\u201C"][A-Za-z'’\\-]+[\\u201D"])?(?:\\s+[A-Z]\\.)?(?:\\s+[A-Z][A-Za-z'’\\-]+){0,3}(?:\\s+(?:Jr|Sr|II|III|IV)\\.?)?`

/** "Name Age Director Since … Warren “Barry” Phelps III 79 2007 Chairman of the Board Dr. Lisa Costa 62 2020 Director" */
function readDirectorRoster(text: string, directors: Director[], officers: Officer[]) {
  const at = text.search(/Name\s+Age\s+Director Since/i)
  if (at < 0) return
  const window = text.slice(at, at + 1800).split(/As previously disclosed|Class [IVX]+ Director|The following/i)[0]
  const gap = "(?:\\s|[•●▪·]|(?:\\b(?:Chair|Independent|Audit|Compensation|Nominating|Governance)\\b\\s*))+"
  const row = new RegExp(`(${DIRECTOR_NAME})\\s+(\\d{2})\\s+((?:19|20)\\d{2})\\s+([A-Za-z][^•●▪·\\d]{2,70}?)(?=${gap}${DIRECTOR_NAME}\\s+\\d{2}\\b|\\s+As previously|$)`, "g")
  for (const match of window.matchAll(row)) {
    const name = match[1].replace(/\s+/g, " ").trim().replace(/^(?:Chair|Independent|Audit|Compensation|Nominating|Governance)\s+/, "")
    if (!name.includes(" ") || directors.some((director) => director.name === name) || NOT_A_NAME.test(name)) continue
    const note = match[4].replace(/\s+/g, " ").trim().replace(/[,;]$/, "")
    directors.push({ name, since: match[3], note: /^director$/i.test(note) ? null : note, bio: null })
    const officer = officers.find((person) => person.name === name)
    if (officer && !officer.since) officer.since = match[3]
  }
  const bioRow = new RegExp(`((?:[A-Z]{2,}(?:\\s+[A-Z][A-Z'’\\-]+){1,4})|${PERSON})\\s+has been a director`, "g")
  for (const match of text.matchAll(bioRow)) {
    const raw = match[1].trim()
    const name = /[a-z]/.test(raw) ? raw : capsName(`${raw} `)
    if (!name) continue
    const director = directors.find((person) => person.name === name || lastName(person.name) === lastName(name))
    if (!director || director.bio) continue
    director.bio = clipBio(text.slice((match.index ?? 0) + raw.length, (match.index ?? 0) + raw.length + 700))
  }
}

function readDirectorSince(text: string, directors: Director[], officers: Officer[]) {
  const row = new RegExp(`(${PERSON})\\s+(?:((?:Chair|Chief|President|Officer|Executive)[^.]{0,50}?)\\s+)?Director since\\s+((?:19|20)\\d{2})\\b`, "g")
  for (const match of text.matchAll(row)) {
    const name = match[1].trim()
    const after = text.slice(match.index ?? 0, (match.index ?? 0) + 180)
    if (!/Key Skills/i.test(after)) continue
    if (NOT_A_NAME.test(name) || directors.some((director) => director.name === name)) continue
    if (/table of contents/i.test(match[2] || "")) continue
    directors.push({ name, since: match[3], note: cleanNote(match[2]?.trim() || null), bio: null })
    const officer = officers.find((person) => person.name === name)
    if (officer && !officer.since) officer.since = match[3]
  }
}

function applyOwnership(text: string, officers: Officer[]) {
  const at = text.search(/Percent of Common Stock Outstanding/i)
  if (at < 0) return
  const window = text.slice(at, at + 2200)
  const row = new RegExp(`(${PERSON})\\s+([\\d,]{2,})\\s+\\(\\d+\\)\\s+(\\d+(?:\\.\\d+)?%|\\*)`, "g")
  for (const match of window.matchAll(row)) {
    const officer = officers.find((person) => person.name === match[1].trim())
    if (!officer || officer.shares != null) continue
    officer.shares = Number(match[2].replace(/,/g, ""))
    officer.ownership = match[3] === "*" ? "under 1%" : match[3]
  }
}

function titleCase(raw: string): string {
  return raw.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, boundary: string, letter: string) => boundary + letter.toUpperCase())
}

function capsName(before: string): string | null {
  const tokens = before.trim().split(/\s+/)
  const picked: string[] = []
  for (let i = tokens.length - 1; i >= 0 && picked.length < 6; i--) {
    const token = tokens[i].replace(/[,:;]+$/g, "")
    if (/^\(?[A-Z][A-Z'’\-]+\)?$/.test(token) || /^[A-Z]\.$/.test(token)) picked.unshift(token)
    else break
  }
  const words = picked.filter((token) => !/^\([A-Z'’\-]+\)$/.test(token))
  if (words.length < 2) return null
  const initial = words.findIndex((token) => /^[A-Z]\.$/.test(token))
  const kept = initial > 0 ? words.slice(initial - 1) : words.slice(-2)
  return titleCase(kept.join(" "))
}

/** "Stefano Caroti 63 Chief Executive Officer…" under an Executive Officer / Age / Position table. */
function readRoster(text: string, officers: Officer[]) {
  const at = text.search(/EXECUTIVE OFFICER\s+AGE\s+POSITION/i)
  if (at < 0) return
  const window = text.slice(at, at + 1400)
  const row = new RegExp(`(${PERSON})\\s+(\\d{2})\\s+((?:Chief|President)[\\s\\S]{3,80}?)(?=\\s+${PERSON}\\s+\\d{2}\\b|\\s+[A-Z]{2,}(?:\\s+[A-Z][A-Z'’\\-]+)+\\s+Age:)`, "g")
  for (const match of window.matchAll(row)) {
    const role = match[3].replace(/\s+/g, " ").trim().replace(/[,;]$/, "")
    upsertOfficer(officers, match[1].trim(), role, Number(match[2]), null)
  }
}

/** "STEFANO CAROTI Age: 63 Position: Chief Executive Officer… Mr. Caroti was appointed…" */
function readPositionBios(text: string, officers: Officer[]) {
  const row = /([A-Z]{2,}(?:\s+[A-Z]\.)?(?:\s+[A-Z][A-Z'’\-]+){1,3})\s+Age:\s+(\d{2})\s+Position:\s+([\s\S]{5,140}?)\s+(?=(?:Mr|Ms|Mrs|Dr)\.\s+)/g
  for (const match of text.matchAll(row)) {
    const name = capsName(`${match[1]} `)
    if (!name) continue
    const role = match[3].replace(/\s+/g, " ").trim()
    if (!/Chief|President|Officer/.test(role)) continue
    const bioStart = (match.index ?? 0) + match[0].length
    upsertOfficer(officers, name, role, Number(match[2]), clipBio(text.slice(bioStart, bioStart + 700)))
  }
}

/** Pay tables that put the title on the line after the latest year's numbers. */
function payTableAt(text: string): number {
  return text.search(/Name and Principal Position(?:\s*\([^)]{1,20}\))?\s+Year\s+Salary/i)
}

/** "Name Age Current Position(s) David Meniane 43 Chief Executive Officer Mark DiSiena…" */
function readNameAgePosition(text: string, officers: Officer[]) {
  const at = text.search(/Name\s+Age\s+Current Position/i)
  if (at < 0) return
  const window = text.slice(at, at + 1400).split(/biographical information/i)[0]
  const row = new RegExp(`(${PERSON})\\s+(\\d{2})\\s+((?:Interim\\s+)?(?:Chief|President|Chairman)[A-Za-z ,]{0,60}?)(?=\\s+${PERSON}\\s+\\d{2}\\b|$)`, "g")
  for (const match of window.matchAll(row)) {
    const role = match[3].replace(/\s+/g, " ").trim().replace(/[,;]$/, "")
    upsertOfficer(officers, match[1].trim(), role, Number(match[2]), null)
  }
}

/** "DAVID MENIANE has served as our Chief Executive Officer…" and the same sentence in title case. */
function readServedBios(text: string, officers: Officer[]) {
  const row = new RegExp(`((?:[A-Z]{2,}(?:\\s+[A-Z][A-Z'’\\-]+){1,3})|${PERSON})\\s+has served as (?:our|the)\\s+((?:Interim\\s+)?(?:Chief|President)[^.]{0,120})`, "g")
  for (const match of text.matchAll(row)) {
    const raw = match[1].trim()
    const name = /[a-z]/.test(raw) ? raw : capsName(`${raw} `)
    if (!name) continue
    const role = match[2].replace(/\s+/g, " ").trim().split(/\s+since\s+|\s+and director\b/i)[0].replace(/[,;]$/, "")
    const start = (match.index ?? 0) + raw.length
    upsertOfficer(officers, name, role, null, clipBio(text.slice(start, start + 750)))
  }
}

function readPayFollowingTitle(text: string, officers: Officer[]) {
  const at = payTableAt(text)
  if (at < 0) return
  const window = text.slice(at, at + 7000)
  const row = new RegExp(
    `(${PERSON})(?:\\s+\\(\\d+\\))?\\s+(20\\d\\d)\\s+([0-9,\\s.—–-]{8,180}?)\\s+((?:Chief|President)[^\\d]{1,80}?)(?=\\s+20\\d\\d\\b|\\s+${PERSON}\\b)`,
    "g",
  )
  for (const match of window.matchAll(row)) {
    const name = match[1].trim()
    const role = match[4].replace(/\s+/g, " ").trim().replace(/[,;]$/, "")
    const parts = payParts(yearAmounts(match[3]))
    const existing = officers.find((officer) => officer.name === name)
    if (existing) {
      if (existing.salary == null) existing.salary = parts.salary
      if (existing.equityPay == null) existing.equityPay = parts.equityPay
      if (existing.incentive == null) existing.incentive = parts.incentive
      if (existing.totalPay == null) existing.totalPay = parts.totalPay
      if (!existing.role) existing.role = role
    } else {
      upsertOfficer(officers, name, role, null, null)
      const created = officers.find((officer) => officer.name === name)
      if (!created) continue
      created.salary = parts.salary
      created.equityPay = parts.equityPay
      created.incentive = parts.incentive
      created.totalPay = parts.totalPay
    }
  }
}

/** "CYNTHIA (CINDY) L. DAVIS Age: 64 Director Since: 2018 … Biographical Information …" */
function readDirectorBlocks(text: string, directors: Director[], officers: Officer[]) {
  const row = /([A-Z]{2,}(?:\s+\([A-Z][A-Z .'\-]+\))?(?:\s+[A-Z]\.)?(?:\s+[A-Z][A-Z'’\-]+){0,3})\s+Age:\s+(\d{2})\s+Director Since:\s+((?:19|20)\d{2})\s+([\s\S]{0,300}?)\s+Biographical Information\s+/g
  for (const match of text.matchAll(row)) {
    const name = capsName(`${match[1].replace(/\([^)]*\)/g, " ")} `)
    if (!name || directors.some((director) => director.name === name) || officers.some((officer) => officer.name === name)) continue
    const blob = match[4]
    const note = /chair of (?:our|the) board/i.test(blob)
      ? "Chair of the board"
      : (blob.match(/Board Committees:\s*(.{4,80}?)(?=\s+Public Company|\s+Biographical|$)/i)?.[1] ?? "").replace(/\s+/g, " ").trim() || null
    const start = (match.index ?? 0) + match[0].length
    const rest = text.slice(start, start + 900)
    const stop = rest.search(/\s+[A-Z]{2,}(?:\s+\([A-Z]|\s+[A-Z]\.)?(?:\s+[A-Z][A-Z'’\-]+){0,3}\s+Age:/)
    const bio = clipBio(stop > 40 ? rest.slice(0, stop) : rest.slice(0, 550))
    directors.push({ name, since: match[3], note, bio })
    const officer = officers.find((person) => person.name === name)
    if (officer && !officer.since) officer.since = match[3]
  }
}

function readHolders(text: string, officers: Officer[]): Holder[] {
  const at = text.search(/Percent of Common Stock Outstanding/i)
  if (at < 0) return []
  const window = text.slice(at, at + 1800)
  const row = /([A-Z][A-Za-z&.'’\-]+(?:\s+[A-Z][A-Za-z&.'’\-]+){1,5})\s+([\d,]{6,})\s+\(\d+\)\s+(\d+(?:\.\d+)?)%/g
  const holders: Holder[] = []
  for (const match of window.matchAll(row)) {
    let name = match[1].trim()
    if (/Outstanding|Common Stock|Percent|Beneficial|Shares of/.test(name)) {
      const the = name.match(/\bThe\s+[A-Z].*$/)
      if (!the) continue
      name = the[0]
    }
    const ownership = `${match[3]}%`
    const pct = Number(match[3])
    if (pct < 5) continue
    if (officers.some((officer) => officer.name === name)) continue
    if (holders.some((holder) => holder.name === name)) continue
    holders.push({ name, shares: Number(match[2].replace(/,/g, "")), ownership })
  }
  return holders.slice(0, 6)
}

function blankOfficer(name: string, role: string, age: number | null): Officer {
  return {
    name,
    age,
    role,
    since: null,
    salary: null,
    equityPay: null,
    incentive: null,
    totalPay: null,
    shares: null,
    ownership: null,
    bio: null,
  }
}

/** Pay rows that put the title, then the year, then bare numbers. The header wording varies. */
function readCompensationRows(text: string, officers: Officer[]) {
  let best = -1
  for (const match of text.matchAll(/Summary Compensation Table/gi)) {
    const after = text.slice(match.index ?? 0, (match.index ?? 0) + 2200)
    if (new RegExp(`${PERSON}\\s+(?:Chair|Chief|President|Executive)`).test(after)) best = match.index ?? -1
  }
  if (best < 0) return
  const window = text.slice(best, best + 8000)
  const row = new RegExp(
    `(${PERSON})\\s+((?:Chair(?:man|woman|person)?(?:,|\\s+and)?\\s+)?(?:President(?:,|\\s+and)\\s+)?(?:Chief|Executive Vice)[^\\d]{3,120}?)\\s+(20\\d\\d)\\s+([\\d,\\s.0—–-]{6,220}?)(?=\\s+20\\d\\d\\b|\\s+${PERSON}\\s+)`,
    "g",
  )
  const seen = new Set<string>()
  for (const match of window.matchAll(row)) {
    const name = match[1].trim()
    const role = match[2].replace(/\s+/g, " ").trim().replace(/[,;]$/, "")
    if (seen.has(name) || NOT_A_NAME.test(name) || !/Chief|President|Officer|Chair/.test(role)) continue
    seen.add(name)
    const parts = payParts(yearAmounts(match[4]))
    const existing = officers.find((officer) => officer.name === name)
    if (existing) {
      if (!existing.role) existing.role = role
      if (existing.salary == null) existing.salary = parts.salary
      if (existing.equityPay == null) existing.equityPay = parts.equityPay
      if (existing.incentive == null) existing.incentive = parts.incentive
      if (existing.totalPay == null) existing.totalPay = parts.totalPay
    } else {
      const created = blankOfficer(name, role, null)
      created.salary = parts.salary
      created.equityPay = parts.equityPay
      created.incentive = parts.incentive
      created.totalPay = parts.totalPay
      officers.push(created)
    }
  }
}

function officeRole(role: string): boolean {
  if (/\b(University|LLP|Retired|Law Firm)\b/i.test(role)) return false
  return /Chief|President|Officer|Vice President|CEO|Controller|Executive Chair/.test(role)
}

function officerWindow(text: string): string {
  for (const match of text.matchAll(/information about our executive officers/gi)) {
    const at = (match.index ?? 0) + match[0].length
    const after = text.slice(at, at + 100)
    if (/\bitem\s+\d/i.test(after) || /^\s+\d{1,3}\s+(?:item|part)\b/i.test(after)) continue
    return text.slice(at, at + 5500)
  }
  return ""
}

/** Officers named in the annual report, where the proxy is a brochure and the 10-K still has a table. */
export function readFilingPeople(html: string): PeopleRead {
  const text = htmlToText(html)
  const officers: Officer[] = []
  const directors: Director[] = []
  const window = officerWindow(text)
  if (window) {
    const agedTitle = new RegExp(`(${PERSON})\\s+\\((\\d{2})\\)\\s+((?:Chief|Chair|President|Executive|Senior|Vice)[^()]{3,120}?)\\s+\\(((?:19|20)\\d{2})\\)`, "g")
    for (const match of window.matchAll(agedTitle)) {
      upsertOfficer(officers, match[1].trim(), match[3].replace(/\s+/g, " ").trim(), Number(match[2]), null)
    }
    const ageThenTitle = new RegExp(`(${PERSON})\\s+(\\d{2})\\s+((?:Chief|Chair|President|Executive|Senior|Vice|CEO|Principal)[^(]{3,110}?)\\s*(?:\\(\\d+\\))?\\s+((?:19|20)\\d{2})\\b`, "g")
    for (const match of window.matchAll(ageThenTitle)) {
      const role = match[3].replace(/\s+/g, " ").trim().replace(/[,;]$/, "")
      if (!officeRole(role)) continue
      upsertOfficer(officers, match[1].trim(), role.split(/\s+since\s+/i)[0], Number(match[2]), null)
    }
    const ageThenRole = new RegExp(`(${PERSON})\\s+(\\d{2})\\s+((?:Chief|Chair|President|Executive|Senior|Vice|CEO|Principal)[^.]{3,140}?)(?=\\s+${PERSON}\\s+\\d{2}\\b|\\s+${PERSON}\\.)`, "g")
    for (const match of window.matchAll(ageThenRole)) {
      const role = match[3].replace(/\s+/g, " ").trim().replace(/[,;]$/, "")
      if (!officeRole(role)) continue
      upsertOfficer(officers, match[1].trim(), role.split(/\s+since\s+/i)[0], Number(match[2]), null)
    }
    const experience = new RegExp(`(${PERSON})\\s+((?:Executive Vice President|Senior Vice President|Chief|President)[^.]{3,140}?)[.,]\\s+[\\s\\S]{15,700}?\\b(?:19|20)\\d{2}\\s+(\\d{2})\\s+(?=${PERSON}\\b)`, "g")
    for (const match of window.matchAll(experience)) {
      const role = match[2].replace(/\s+/g, " ").trim().replace(/[,;]$/, "").split(/\s+since\s+/i)[0]
      if (!officeRole(role)) continue
      upsertOfficer(officers, match[1].trim(), role, Number(match[3]), null)
    }
  }
  readForeignBoard(text, officers, directors)
  readManagementTable(text, officers, directors)
  officers.sort((a, b) => rankOfficer(a) - rankOfficer(b))
  return {
    officers: officers.slice(0, 12),
    directors: directors.slice(0, 16),
    holders: [],
    groupOwnership: null,
  }
}

const INITIALS = `(?:[A-Z]\\.){1,3}\\s+[A-Z][A-Za-z'’\\-]+`

function readForeignBoard(text: string, officers: Officer[], directors: Director[]) {
  const at = text.search(/Board of Directors\s+Name\s+Age\s+Position/i)
  if (at < 0) return
  const window = text.slice(at, at + 3200).split(/Executive Officers\s+Name\s+Position|Senior Management/i)[0]
  const filingName = `(?:Sir\\s+${PERSON}|(?:[A-Z]\\.\\s+)?${INITIALS}|(?:[A-Z]\\.\\s+)?${PERSON})(?:\\s*\\(\\d+\\))?`
  const row = new RegExp(`(${filingName})\\s+(\\d{2})(?:-\\d{2})?\\s+([^\\d]{3,90}?)\\s+((?:19|20)\\d{2})\\s+(\\d{1,2})\\b`, "g")
  for (const match of window.matchAll(row)) {
    const name = match[1].replace(/\s*\(\d+\)\s*$/, "").replace(/\s+/g, " ").trim()
    const role = match[3].replace(/\s+/g, " ").trim().replace(/[;,]$/, "")
    if (NOT_A_NAME.test(name) || directors.some((director) => director.name === name)) continue
    const age = Number(match[2])
    directors.push({
      name,
      since: match[4],
      note: /independent/i.test(role) ? "Independent director" : role,
      bio: null,
    })
    if (/Chief|President|Chairman|Chair/.test(role)) upsertOfficer(officers, name, role, age, null)
  }
}

/** A 20-F table headed Name, Age, Position/Title. */
function readManagementTable(text: string, officers: Officer[], directors: Director[]) {
  const at = text.search(/Name\s+\(\d+\)\s+Age\s+Position\/Title/i)
  if (at < 0) return
  const window = text
    .slice(at, at + 2400)
    .replace(/\s+/g, " ")
    .replace(/^.*?Position\/Title\s+/i, "")
    .split(/Director nominated|Biographical Information|\(a\)\s+Group/i)[0]
  const word = "(?!(?:Chief|Director|President|Chairman|Independent|General|Counsel|Officer|People|Financial)\\b)[A-Z](?:[a-zA-Z.'’\\-]+|\\.)"
  const name = `${word}(?:\\s+${word}){0,4}\\s+[A-Z]{2,}`
  const row = new RegExp(
    `(${name})\\s+[†*]?\\s*(?:\\([a-z0-9]+\\)\\s*)*(\\d{2})\\s+((?:Chairman|Director|Independent director|Chief|President|General Counsel)(?:(?!\\s+${name}).){0,90})`,
    "g",
  )
  for (const match of window.matchAll(row)) {
    const person = match[1].replace(/\s+/g, " ").trim()
    const age = Number(match[2])
    const role = match[3].replace(/\s+/g, " ").replace(/[†*].*$/, "").trim().replace(/[,;]$/, "")
    if (NOT_A_NAME.test(person) || age < 25 || age > 90 || directors.some((director) => director.name === person)) continue
    if (/director|chairman|\bchair\b/i.test(role)) {
      directors.push({
        name: person,
        since: "",
        note: /independent/i.test(role) ? "Independent director" : role,
        bio: null,
      })
    }
    if (/Chief|President|Chairman|Chair|General Counsel/.test(role)) upsertOfficer(officers, person, role, age, null)
  }
}

export function mergePeople(first: PeopleRead | null, second: PeopleRead | null): PeopleRead | null {
  if (!first?.officers.length && !first?.directors.length) return second ?? first
  if (!second?.officers.length && !second?.directors.length) return first
  if (!first) return second
  if (!second) return first
  const officers = [...first.officers]
  for (const officer of second.officers) {
    const existing = officers.find((item) => item.name === officer.name)
    if (!existing) {
      officers.push(officer)
      continue
    }
    if (!existing.role) existing.role = officer.role
    if (existing.age == null) existing.age = officer.age
    if (!existing.bio && officer.bio) existing.bio = officer.bio
    if (existing.salary == null) existing.salary = officer.salary
    if (existing.equityPay == null) existing.equityPay = officer.equityPay
    if (existing.incentive == null) existing.incentive = officer.incentive
    if (existing.totalPay == null) existing.totalPay = officer.totalPay
  }
  const directors = [...first.directors]
  for (const director of second.directors) {
    if (!directors.some((item) => item.name === director.name)) directors.push(director)
  }
  officers.sort((a, b) => rankOfficer(a) - rankOfficer(b))
  return {
    officers: officers.slice(0, 12),
    directors: directors.slice(0, 16),
    holders: first.holders.length ? first.holders : second.holders,
    groupOwnership: first.groupOwnership ?? second.groupOwnership,
  }
}

function readGroup(text: string): string | null {
  const match = text.match(/as a group\s*\((\d+)\s+persons\)\s+([\d,]+)\s+\(\d+\)\s+(\*|[\d.]+%)/i)
  if (!match) return null
  const shares = Number(match[2].replace(/,/g, "")).toLocaleString("en-US")
  const stake = match[3] === "*" ? "under 1%" : match[3]
  return `${stake} of the class, ${shares} shares, officers and directors together`
}

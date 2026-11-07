import { htmlToText } from "./plain"

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
}

export type PeopleRead = {
  officers: Officer[]
  directors: Director[]
  groupOwnership: string | null
}

const WORD = "[A-Z][a-z]*(?:[A-Z][a-z]+)*"
const NOT_NAME = "Principal|Position|Year|Salary|Stock|Awards|Total|Name|Compensation|Incentive|Other|Equity|Plan|All|Non|Summary|Table|Director"
const PERSON = `(?!${NOT_NAME}\\b)${WORD}(?:\\s[A-Z]\\.)?\\s(?!${NOT_NAME}\\b)${WORD}`
const NOT_A_NAME = new RegExp(`^(${NOT_NAME})\\b`)

function dollars(block: string): number[] {
  return [...block.matchAll(/\$\s*([\d,]+)/g)].map((match) => Number(match[1].replace(/,/g, "")))
}

function payParts(amounts: number[]): { salary: number | null; equityPay: number | null; incentive: number | null; totalPay: number | null } {
  if (amounts.length >= 5) {
    return { salary: amounts[0], equityPay: amounts[1], incentive: amounts[2], totalPay: amounts[4] }
  }
  if (amounts.length === 4) {
    return { salary: amounts[0], equityPay: amounts[1], incentive: amounts[2], totalPay: amounts[3] }
  }
  return { salary: amounts[0] ?? null, equityPay: amounts[1] ?? null, incentive: null, totalPay: amounts[amounts.length - 1] ?? null }
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

  const payAt = text.search(/Name and Principal Position Year Salary/i)
  if (payAt >= 0) {
    const pay = text.slice(payAt, payAt + 7000)
    const row = new RegExp(`(${PERSON})\\s+([^$\\d]{8,180}?)\\s+(20\\d\\d)\\s+([\\s\\S]{8,240}?)(?=\\s+20\\d\\d\\s+\\$|\\s+${PERSON}\\s+)`, "g")
    const seen = new Set<string>()
    for (const match of pay.matchAll(row)) {
      const name = match[1].trim()
      const role = match[2].replace(/\s+/g, " ").trim()
      if (seen.has(name) || NOT_A_NAME.test(name)) continue
      if (!/Chief|President|Officer|Chairman|Vice/.test(role)) continue
      seen.add(name)
      const parts = payParts(dollars(match[4]))
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
    const row = new RegExp(`(${PERSON})\\s+\\(\\d+\\)\\s+([\\d,]+)\\s+(\\d+(?:\\.\\d+)?%|\\*)`, "g")
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
      directors.push({ name, since: match[3], note: match[2]?.trim() || null })
      const officer = officers.find((person) => person.name === name)
      if (officer && !officer.since) officer.since = match[3]
    }
  }

  return { officers: officers.slice(0, 12), directors: directors.slice(0, 16), groupOwnership }
}

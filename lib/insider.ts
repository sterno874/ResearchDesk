import { readEntry, writeEntry } from "./persist"
import type { Submissions } from "./sec"

const FRESH_MS = 12 * 60 * 60 * 1000
const AGENT = "ResearchDesk (personal research desk; contact researchdesk@example.com)"

export type InsiderTrades = {
  bought: number
  sold: number
  /** Forms whose XML was actually read. Zero means the index was all we had. */
  read: number
}

function padCik(cik: string): string {
  return cik.replace(/\D/g, "").padStart(10, "0")
}

function documentUrl(cik: string, accession: string, document: string): string {
  const cikInt = String(parseInt(padCik(cik), 10))
  const acc = accession.replace(/-/g, "")
  const name = document.replace(/^xslF345X\d+\//i, "")
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${acc}/${name}`
}

function readable(xml: string): boolean {
  return /<nonDerivativeTransaction\b|<derivativeTransaction\b|<ownershipDocument\b/i.test(xml)
}

function tradesIn(xml: string): { bought: number; sold: number } {
  let bought = 0
  let sold = 0
  for (const part of xml.split(/<nonDerivativeTransaction\b/i).slice(1)) {
    const block = part.split(/<\/nonDerivativeTransaction>/i)[0]
    const code = /<transactionCode>\s*(?:<value>)?\s*([A-Z])\s*(?:<\/value>)?\s*<\/transactionCode>/i.exec(block)?.[1]
    const shares = Number(/<transactionShares>\s*<value>\s*([\d.]+)\s*<\/value>/i.exec(block)?.[1])
    const side = /<transactionAcquiredDisposedCode>\s*(?:<value>)?\s*([AD])\s*(?:<\/value>)?\s*<\/transactionAcquiredDisposedCode>/i.exec(block)?.[1]
    if (!Number.isFinite(shares) || shares <= 0) continue
    if (code === "P" && side !== "D") bought += shares
    if (code === "S" && side !== "A") sold += shares
  }
  return { bought, sold }
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": AGENT, Accept: "application/xml, text/xml, text/plain, */*" },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    })
    if (!response.ok) return null
    return response.text()
  } catch {
    return null
  }
}

/** Open-market purchases and sales on Form 4s from the last 120 days. Grants and withholding are left out. */
export async function readInsiderTrades(cik: string, submissions: Submissions | null, fresh = false): Promise<InsiderTrades> {
  const empty = { bought: 0, sold: 0, read: 0 }
  const key = `cache/form4-${padCik(cik)}.json`
  if (!fresh) {
    const entry = await readEntry(key)
    if (entry && Date.now() - entry.updatedAt < FRESH_MS) {
      try {
        const parsed = JSON.parse(entry.text) as InsiderTrades
        if (parsed && typeof parsed.read === "number") return parsed
      } catch {
        // A broken cache is read again.
      }
    }
  }
  const recent = submissions?.filings?.recent
  if (!recent?.form?.length) return empty
  const now = Date.now()
  const urls: string[] = []
  for (let i = 0; i < recent.form.length && urls.length < 8; i++) {
    if (recent.form[i] !== "4") continue
    const date = recent.filingDate?.[i] ?? ""
    const age = date ? (now - Date.parse(date)) / 86400000 : 9999
    if (age > 120) continue
    const accession = recent.accessionNumber?.[i]
    const document = recent.primaryDocument?.[i]
    if (!accession || !document) continue
    urls.push(documentUrl(cik, accession, document))
  }
  if (!urls.length) return empty
  let bought = 0
  let sold = 0
  let read = 0
  for (let i = 0; i < urls.length; i += 3) {
    const batch = await Promise.all(urls.slice(i, i + 3).map(fetchXml))
    for (const xml of batch) {
      if (!xml || !readable(xml)) continue
      const trades = tradesIn(xml)
      bought += trades.bought
      sold += trades.sold
      read += 1
    }
  }
  const result = { bought, sold, read }
  if (read > 0) await writeEntry(key, JSON.stringify(result)).catch(() => undefined)
  return result
}

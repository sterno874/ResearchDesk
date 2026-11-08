import { SEC_HEADERS } from "./http"
import { readEntry, writeEntry } from "./persist"
import { loadSubmissions, type Submissions } from "./sec"

export type FiledDoc = {
  form: string
  filed: string
  url: string
  html: string
}

function documentUrl(cik: string, accession: string, file: string): string {
  const cikInt = String(parseInt(cik, 10))
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accession.replace(/-/g, "")}/${file}`
}

function findForm(submissions: Submissions, forms: string[]): { form: string; accession: string; file: string; filed: string } | null {
  const recent = submissions.filings?.recent
  if (!recent?.form?.length) return null
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i] ?? ""
    if (!forms.includes(form)) continue
    const accession = recent.accessionNumber?.[i]
    const file = recent.primaryDocument?.[i]
    const filed = recent.filingDate?.[i]
    if (!accession || !file || !filed) continue
    return { form, accession, file, filed }
  }
  return null
}

async function readHtml(
  cik: string,
  doc: { form: string; accession: string; file: string; filed: string },
  fresh: boolean,
): Promise<FiledDoc> {
  const key = `cache/html-${doc.accession}.html`
  const url = documentUrl(cik, doc.accession, doc.file)
  if (!fresh) {
    const cached = await readEntry(key)
    if (cached) return { form: doc.form, filed: doc.filed, url, html: cached.text }
  }
  const response = await fetch(url, {
    headers: { ...SEC_HEADERS, Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(90000),
  })
  if (!response.ok) throw new Error(`${response.status} reading the ${doc.form}`)
  const html = await response.text()
  await writeEntry(key, html)
  return { form: doc.form, filed: doc.filed, url, html }
}

export async function loadAnnual(cik: string, fresh = false): Promise<FiledDoc | null> {
  const submissions = await loadSubmissions(cik)
  const doc = findForm(submissions, ["10-K", "20-F", "40-F"])
  if (!doc) return null
  return readHtml(cik, doc, fresh)
}

export async function loadProxy(cik: string, fresh = false): Promise<FiledDoc | null> {
  const submissions = await loadSubmissions(cik)
  const doc = findForm(submissions, ["DEF 14A"])
  if (!doc) return null
  return readHtml(cik, doc, fresh)
}

export async function companySic(cik: string): Promise<{ sic: string | null; sicDescription: string | null }> {
  const submissions = await loadSubmissions(cik)
  return { sic: submissions.sic ?? null, sicDescription: submissions.sicDescription ?? null }
}

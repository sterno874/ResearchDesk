import { cache } from "react"
import { loadField } from "./field"
import { loadAnnual, loadProxy } from "./filingdoc"
import { htmlToText } from "./plain"
import { readAnnual, readOverview } from "./ixbrl"
import { mergePeople, readFilingPeople, readPeople } from "./people"
import { scoreAll } from "./investors"
import { getQuote } from "./market"
import { buildMetrics } from "./metrics"
import { buildHeadline, buildMemo, buildPitch } from "./narrative"
import { loadFacts, loadSubmissions, loadUniverse, normalizeTicker } from "./sec"
import { describeSector, loadStudies, sectorId, takesDeposits } from "./sector"
import { shorthand, statementGaps } from "./rank"
import { saveRead } from "./reads"
import { buildTraps } from "./traps"
import type { Memo, ReportResult, Trap } from "./types"

function profileGaps(input: {
  company: string
  metrics: { revenue: number | null; operatingIncome: number | null; netIncome: number | null; equity: number | null; cfo: number | null; fcf: number | null }
  annual: { lines: { revenue: number | null }[] } | null
  officers: number
  triedProxy: boolean
}): string[] {
  const draft = {
    company: input.company,
    metrics: input.metrics,
  }
  const gaps = statementGaps(draft as Parameters<typeof statementGaps>[0])
  const split = input.annual?.lines.some((line) => (line.revenue ?? 0) > 0) ?? false
  if (!split) gaps.push("what the business sells")
  if (!input.triedProxy || input.officers === 0) gaps.push("who runs it")
  return gaps
}

function attachWall(memo: Memo, traps: Trap[]): Memo {
  const wall = traps.find((trap) => trap.timeline)
  if (!wall?.timeline) return memo
  return {
    ...memo,
    label: memo.kind === "unclear" ? "The debt comes due" : memo.label,
    summary: memo.summary,
    stages: [wall.timeline, ...memo.stages.slice(0, 3)],
  }
}

export const getReport = cache(async (raw: string, fresh = false): Promise<ReportResult> => {
  const ticker = normalizeTicker(raw)
  if (!/^[A-Z0-9-]{1,8}$/.test(ticker)) {
    return { ok: false, ticker: raw.toUpperCase(), message: "Use a ticker like AAPL or BRK-B." }
  }
  const universe = await loadUniverse()
  const company = universe.byTicker.get(ticker)
  if (!company) {
    return {
      ok: false,
      ticker,
      message: `${ticker} is not in the SEC company list, so there are no annual filings to score. Funds and many foreign listings fall outside this desk.`,
    }
  }

  const [factsResult, submissionsResult, quoteResult, annualResult, proxyResult] = await Promise.allSettled([
    loadFacts(company.cik, fresh),
    loadSubmissions(company.cik),
    getQuote(company.ticker),
    loadAnnual(company.cik, fresh),
    loadProxy(company.cik, fresh),
  ])
  if (factsResult.status === "rejected") {
    return { ok: false, ticker, message: "EDGAR didn't return the company facts. Try the report again in a moment." }
  }
  const metrics = buildMetrics({
    company,
    facts: factsResult.value,
    submissions: submissionsResult.status === "fulfilled" ? submissionsResult.value : null,
    quote: quoteResult.status === "fulfilled" ? quoteResult.value : null,
  })
  if (metrics.revenue == null && metrics.netIncome == null && metrics.equity == null) {
    return {
      ok: false,
      ticker,
      message: `${company.name} files with the SEC, but the annual statements this desk needs are missing from the XBRL feed.`,
    }
  }
  const submissions = submissionsResult.status === "fulfilled" ? submissionsResult.value : null
  const filedAs = sectorId(submissions?.sic ?? null, submissions?.sicDescription ?? null)
  const id = filedAs === "operating" && takesDeposits(factsResult.value) ? "bank" : filedAs
  const investors = scoreAll(metrics, id).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const [trials, field] = await Promise.all([
    loadStudies(id, company.name, company.cik, fresh),
    loadField({
      company,
      metrics,
      sector: id,
      sic: submissions?.sic ?? null,
      sicDescription: submissions?.sicDescription ?? null,
      universe,
      fresh,
    }),
  ])
  const sector = describeSector(id, metrics, trials.studies, trials.note)
  const draft = buildMemo(metrics, id)
  const annualHtml = annualResult.status === "fulfilled" && annualResult.value ? annualResult.value.html : ""
  const traps = buildTraps({
    facts: factsResult.value,
    metrics,
    memo: draft,
    sic: submissions?.sic ?? null,
    sicDescription: submissions?.sicDescription ?? null,
    submissions,
    history: quoteResult.status === "fulfilled" ? quoteResult.value.history : [],
    annualText: annualHtml ? htmlToText(annualHtml) : "",
  })
  const memo = attachWall(draft, traps)
  const overview = annualResult.status === "fulfilled" && annualResult.value
    ? readOverview(annualResult.value.html)
    : ""
  const sic = submissions?.sicDescription
  const companyLine = overview
    || (sic
      ? `${company.name} files with the SEC as ${sic.toLowerCase()}. The annual report did not yield a clean business description on this pass.`
      : `${company.name} has annual figures on file. A business description was not extracted on this pass.`)
  const annual = annualResult.status === "fulfilled" ? annualResult.value : null
  const parsedAnnual = annual ? readAnnual(annual.html) : null
  const proxyPeople = proxyResult.status === "fulfilled" && proxyResult.value ? readPeople(proxyResult.value.html) : null
  const filingPeople = annual ? readFilingPeople(annual.html) : null
  const people = mergePeople(proxyPeople, filingPeople)
  const gaps = profileGaps({
    company: companyLine,
    metrics,
    annual: parsedAnnual,
    officers: people?.officers.length ?? 0,
    triedProxy: proxyResult.status === "fulfilled",
  })
  const report = {
    metrics,
    investors,
    memo,
    company: companyLine,
    pitch: buildPitch(metrics, memo, traps, id),
    headline: buildHeadline(investors),
    history: quoteResult.status === "fulfilled" ? quoteResult.value.history : [],
    traps,
    gaps,
    sector,
    field,
    pulledFresh: fresh,
  }
  await saveRead({ ...shorthand(report), readAt: new Date().toISOString() }).catch(() => undefined)
  return {
    ok: true,
    report,
  }
})

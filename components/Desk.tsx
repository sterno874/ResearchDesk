"use client"

import { useEffect, useState, type FormEvent } from "react"
import { EventCalendar } from "@/components/Calendar"
import { Pips } from "@/components/Pips"
import { gap, price } from "@/lib/format"
import type { BlotterRead } from "@/lib/rank"
import { apiUrl } from "@/lib/remote"
import { SECTOR_SHORT, type CollectSummary, type Idea, type SectorId, type SourceKind } from "@/lib/types"

const INDUSTRIES: SectorId[] = [
  "bank",
  "insurer",
  "reit",
  "utility",
  "energy",
  "staple",
  "retail",
  "software",
  "chip",
  "auto",
  "telecom",
  "pharma",
  "biotech",
  "operating",
]

const FILTERS: { id: "all" | "saved" | "deep" | SourceKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved" },
  { id: "deep", label: "Deep value" },
  { id: "sec", label: "Filings" },
  { id: "earnings", label: "Earnings" },
  { id: "forum", label: "Forums" },
  { id: "news", label: "News" },
  { id: "manual", label: "Added" },
]

const SORTS: { id: "rank" | "latest" | "name"; label: string }[] = [
  { id: "rank", label: "Rank" },
  { id: "latest", label: "Latest" },
  { id: "name", label: "Name" },
]

function hasDeepGap(read: BlotterRead | undefined): read is BlotterRead & { deepGap: number } {
  return read?.deepGap != null && Number.isFinite(read.deepGap)
}

/** How far the deep-value price sits from the quote. Negative means it is below today's price. */
function fromHere(read: BlotterRead | undefined): number | null {
  if (read?.price == null || read.deep == null || !(read.price > 0) || !Number.isFinite(read.deep)) return null
  return read.deep / read.price - 1
}

function deepLabel(read: BlotterRead): string {
  const move = fromHere(read)
  if (move == null) return ""
  if (Math.abs(move) < 0.005) return "At the quote"
  return `${gap(read.deep ?? null, read.price ?? null)} from here`
}

function deepTitle(read: BlotterRead): string {
  return `Quote ${price(read.price ?? null)} · deep value ${price(read.deep ?? null)}`
}

function when(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function summaryLine(summary: CollectSummary): string {
  if (!summary.added.length && !summary.merged) {
    return summary.counts.length
      ? "Nothing new. Those names were already on the desk."
      : "The sources came back empty."
  }
  const fresh = summary.added.length
  const freshText = fresh === 1 ? "1 new name" : `${fresh} new names`
  const mergedText = summary.merged ? ` ${summary.merged} already on the desk picked up another source.` : ""
  const bits = summary.counts.map((row) => `${row.count} ${row.label}`).join(", ")
  return `Added ${freshText}.${mergedText}${bits ? ` From this pass: ${bits}.` : ""}`
}

export function Desk({ initialIdeas }: { initialIdeas: Idea[] }) {
  const [ideas, setIdeas] = useState(initialIdeas)
  const [ticker, setTicker] = useState("")
  const [busy, setBusy] = useState<"collect" | "add" | string | null>(null)
  const [summary, setSummary] = useState<CollectSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all")
  const [industry, setIndustry] = useState<SectorId | "all">("all")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("rank")
  const [reads, setReads] = useState<Record<string, BlotterRead>>({})
  const [ranking, setRanking] = useState(false)
  const [view, setView] = useState<"list" | "calendar">("calendar")

  const tickerKey = ideas.map((idea) => idea.ticker).join(",")

  useEffect(() => {
    const tickers = tickerKey ? tickerKey.split(",") : []
    if (!tickers.length) return
    let cancel = false
    async function rank() {
      setRanking(true)
      try {
        const cached = await fetch(apiUrl("/api/rank")).then((response) => response.json()) as { reads?: Record<string, BlotterRead> }
        if (cancel) return
        const have = cached.reads ?? {}
        setReads(have)
        const freshCutoff = Date.now() - 12 * 60 * 60 * 1000
        const missing = tickers.filter((ticker) => {
          const read = have[ticker]
          return !read || !Object.prototype.hasOwnProperty.call(read, "deepGap") || !Object.prototype.hasOwnProperty.call(read, "sector") || !Object.prototype.hasOwnProperty.call(read, "payoutLine") || !Object.prototype.hasOwnProperty.call(read, "events") || Date.parse(read.readAt) < freshCutoff
        })
        for (let index = 0; index < missing.length; index += 4) {
          if (cancel) return
          const slice = missing.slice(index, index + 4)
          const response = await fetch(apiUrl("/api/rank"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tickers: slice }),
          })
          const body = await response.json() as { reads?: Record<string, BlotterRead> }
          if (cancel) return
          if (body.reads) setReads(body.reads)
        }
      } catch {
        // The blotter still works without a rank. A later visit tries again.
      } finally {
        if (!cancel) setRanking(false)
      }
    }
    void rank()
    return () => {
      cancel = true
    }
  }, [tickerKey])

  const needle = query.trim().toLowerCase()
  const shown = ideas
    .filter((idea) => {
      if (!needle) return true
      const ticker = idea.ticker.toLowerCase()
      const name = idea.name.toLowerCase()
      const compact = needle.replace(/[^a-z0-9]/g, "")
      const tickerCompact = ticker.replace(/[^a-z0-9]/g, "")
      return ticker.includes(needle) || name.includes(needle) || (compact.length > 0 && tickerCompact.includes(compact))
    })
    .filter((idea) => {
      if (filter === "all") return true
      if (filter === "saved") return Boolean(idea.favorite)
      if (filter === "deep") return hasDeepGap(reads[idea.ticker])
      return idea.sources.some((source) => source.kind === filter)
    })
    .filter((idea) => industry === "all" || reads[idea.ticker]?.sector === industry)
    .sort((a, b) => {
      if (filter === "deep" && sort === "rank") {
        const left = fromHere(reads[a.ticker])
        const right = fromHere(reads[b.ticker])
        const leftDistance = left == null ? Number.POSITIVE_INFINITY : Math.abs(left)
        const rightDistance = right == null ? Number.POSITIVE_INFINITY : Math.abs(right)
        if (leftDistance !== rightDistance) return leftDistance - rightDistance
        return a.ticker.localeCompare(b.ticker)
      }
      if (sort === "name") return a.name.localeCompare(b.name) || a.ticker.localeCompare(b.ticker)
      if (sort === "latest") return b.updatedAt.localeCompare(a.updatedAt) || a.ticker.localeCompare(b.ticker)
      const left = reads[a.ticker]?.stars
      const right = reads[b.ticker]?.stars
      if (left == null && right == null) return b.updatedAt.localeCompare(a.updatedAt)
      if (left == null) return 1
      if (right == null) return -1
      if (right !== left) return right - left
      return (reads[b.ticker]?.median ?? 0) - (reads[a.ticker]?.median ?? 0)
    })

  const rankedCount = ideas.filter((idea) => reads[idea.ticker]).length
  const industries = INDUSTRIES.filter((id) => ideas.some((idea) => reads[idea.ticker]?.sector === id))
  const unread = ideas.some((idea) => !reads[idea.ticker]?.sector)
  const industryName = industry === "all" ? null : SECTOR_SHORT[industry]
  const rankNote = filter === "deep" && sort === "rank"
    ? industryName
      ? ` ${industryName} names, ordered by how far the quote would have to move to reach the deep-value price, closest first. The stars are unchanged.`
      : " This list is how far the quote would have to move to reach the deep-value price, closest first. The stars are unchanged."
    : industryName
      ? ` ${industryName} only. The stars are still the reader median.`
      : ""
  const waitingNote = industry !== "all" && unread && ranking
    ? " Names still being read stay off this list until the filing says the industry."
    : ""

  async function collect() {
    setBusy("collect")
    setError(null)
    try {
      const response = await fetch(apiUrl("/api/collect"), { method: "POST" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Collect failed")
      setIdeas(body.ideas)
      setSummary(body.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Collect failed")
    } finally {
      setBusy(null)
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    const next = ticker.trim()
    if (!next) return
    setBusy("add")
    setError(null)
    try {
      const response = await fetch(apiUrl("/api/watchlist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: next }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Couldn't add that ticker")
      setIdeas(body.ideas)
      setTicker("")
      setSummary(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that ticker")
    } finally {
      setBusy(null)
    }
  }

  async function favorite(idea: Idea) {
    setBusy(idea.ticker)
    setError(null)
    const next = !idea.favorite
    setIdeas((current) => current.map((item) => item.ticker === idea.ticker ? { ...item, favorite: next } : item))
    try {
      const response = await fetch(apiUrl("/api/watchlist"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: idea.ticker, favorite: next }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Couldn't save that name")
      setIdeas(body.ideas)
    } catch (err) {
      setIdeas((current) => current.map((item) => item.ticker === idea.ticker ? { ...item, favorite: idea.favorite } : item))
      setError(err instanceof Error ? err.message : "Couldn't save that name")
    } finally {
      setBusy(null)
    }
  }

  async function remove(symbol: string) {
    setBusy(symbol)
    setError(null)
    try {
      const response = await fetch(apiUrl(`/api/watchlist?ticker=${encodeURIComponent(symbol)}`), { method: "DELETE" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Couldn't remove it")
      setIdeas(body.ideas)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove it")
    } finally {
      setBusy(null)
    }
  }

  return (
    <main>
      <div className="desk-head">
        <p className="kicker">Ideas to investigate</p>
        <h1>The blotter</h1>
        <p className="lede">
          Collect names from EDGAR, value forums, and a news search, then open a report. Five marks are the median of the six readers. The clock is 1–2 quarters, 1–2 years, or 5–10 years, and it says no clock when the numbers do not earn a date. Filings are Schedule 13Ds, insider Form 4s, 10-Qs, and earnings releases filed as 8-Ks. Forums are r/ValueInvesting, r/SecurityAnalysis, r/Undervalued, r/DeepValueInvesting, and r/Burryology. News is a search for undervalued and special-situation stories, plus Clark Street Value.
        </p>
      </div>

      <div className="filters" role="group" aria-label="Watchlist view">
        <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
        <button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>Calendar</button>
      </div>

      <div className="toolbar">
        <form className="ticker-form" onSubmit={add}>
          <label>
            <span className="kicker">Add a ticker</span>
            <input
              type="text"
              name="ticker"
              value={ticker}
              placeholder="INTC, BRK-B"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setTicker(event.target.value)}
            />
          </label>
          <button className="btn ghost" type="submit" disabled={busy !== null}>Add</button>
        </form>
        <button className="btn" type="button" onClick={collect} disabled={busy !== null}>
          {busy === "collect" ? "Collecting…" : "Collect ideas"}
        </button>
      </div>
      <p className="status" aria-live="polite">{summary ? summaryLine(summary) : null}</p>
      {summary?.warnings.length ? <p className="status warn">{summary.warnings.join(" ")}</p> : null}
      {error ? <p className="status warn">{error}</p> : null}

      <label className="find">
        <span className="kicker">Find on the desk</span>
        <input
          type="search"
          name="find"
          value={query}
          placeholder="Ticker or company"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="blotter-controls">
        <div className="filters" role="group" aria-label="Filter the blotter">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="filters" role="group" aria-label="Sort the blotter">
          {SORTS.map((item) => (
            <button key={item.id} type="button" aria-pressed={sort === item.id} onClick={() => setSort(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {industries.length ? (
        <div className="filters" role="group" aria-label="Filter by industry">
          <button type="button" aria-pressed={industry === "all"} onClick={() => setIndustry("all")}>All industries</button>
          {industries.map((id) => (
            <button key={id} type="button" aria-pressed={industry === id} onClick={() => setIndustry(id)}>
              {SECTOR_SHORT[id]}
            </button>
          ))}
        </div>
      ) : null}
      <p className="status">
        {ranking
          ? `Reading filings for a rank. ${rankedCount} of ${ideas.length} ${ideas.length === 1 ? "name has" : "names have"} one.${rankNote}${waitingNote}`
          : rankedCount
            ? `${rankedCount} of ${ideas.length} ranked from the latest report.${rankNote}${waitingNote}`
            : null}
      </p>

      {view === "calendar" ? (
        <EventCalendar
          events={shown.flatMap((idea) => reads[idea.ticker]?.events ?? [])}
          ranking={ranking}
        />
      ) : null}

      {view === "calendar" ? null : shown.length === 0 ? (
        <div className="empty">
          <p className="lede">
            {ideas.length === 0
              ? "The desk is empty. Collect a batch, or type a ticker you already have in mind."
              : needle && filter !== "all"
                ? "Nothing in this filter matches that."
                : needle
                  ? "Nothing on the desk matches that."
                  : filter === "deep" && industry !== "all"
                    ? ranking
                      ? "Reading the filings for a deep-value price in this industry."
                      : "None of the names in this industry has a deep-value price on the latest read."
                    : filter === "deep"
                      ? ranking
                        ? "Reading the filings for a deep-value price."
                        : "None of these names has a deep-value price on the latest read."
                      : industry !== "all"
                        ? ranking
                          ? "Reading the filings. This industry appears once a report is in."
                          : "No names in this industry on the latest read."
                        : "Nothing in this filter."}
          </p>
        </div>
      ) : (
        <div className="blotter">
          {shown.map((idea) => {
            const lead = idea.sources[0]
            const read = reads[idea.ticker]
            return (
              <article className={`row${idea.favorite ? " saved" : ""}`} key={idea.ticker}>
                <a href={`/report/${idea.ticker}`}>
                  <div className="ticker-line">
                    <span className="ticker">{idea.ticker}</span>
                    <Pips stars={read?.stars ?? null} />
                  </div>
                  <div className={`horizon ${read?.horizon ?? "none"}`} title={read?.why}>
                    {read ? read.horizonLabel : ranking ? "Reading" : "No read"}
                    {read?.depth && read.depth > 1 ? <span className="dive-mark">Dive {read.depth}</span> : null}
                  </div>
                  {hasDeepGap(read) ? <div className="deep-gap" title={deepTitle(read)}>{deepLabel(read)}</div> : null}
                  <div className="kicker">{when(lead?.at || idea.updatedAt)}</div>
                </a>
                <a href={`/report/${idea.ticker}`}>
                  <h3>{idea.name}</h3>
                  {read?.sectorLabel ? (
                    <p className="sector-line">{read.sectorLine ? `${read.sectorLabel} · ${read.sectorLine}` : read.sectorLabel}</p>
                  ) : null}
                  {read?.payoutLine ? <p className="sector-line">{read.payoutLine}</p> : null}
                  <p>{lead?.title}</p>
                  <div className="chips">
                    {idea.sources.map((source) => (
                      <span className={`chip ${source.kind}`} key={`${source.kind}-${source.url}-${source.title}`}>
                        {source.label}
                      </span>
                    ))}
                  </div>
                </a>
                <div className="row-actions">
                  <button
                    className={idea.favorite ? "save on" : "save"}
                    type="button"
                    aria-pressed={Boolean(idea.favorite)}
                    onClick={() => favorite(idea)}
                    disabled={busy !== null}
                  >
                    {idea.favorite ? "Saved" : "Save"}
                  </button>
                  <a className="btn" href={`/report/${idea.ticker}`}>Open report</a>
                  <a className="btn ghost" href={`/dive/${idea.ticker}`}>Deep dive</a>
                  <button className="remove" type="button" onClick={() => remove(idea.ticker)} disabled={busy !== null}>
                    Remove
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}

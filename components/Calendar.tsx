"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { heatColor } from "@/lib/events"
import { when } from "@/lib/format"
import type { BlotterRead } from "@/lib/rank"
import { apiUrl } from "@/lib/remote"
import type { DeskEvent, Idea } from "@/lib/types"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthStart(year: number, month: number): string {
  return `${year}-${pad(month + 1)}-01`
}

function monthLast(year: number, month: number): string {
  const last = new Date(year, month + 1, 0).getDate()
  return `${year}-${pad(month + 1)}-${pad(last)}`
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(year, month + delta, 1)
  return { year: date.getFullYear(), month: date.getMonth() }
}

function byDate(a: DeskEvent, b: DeskEvent): number {
  return a.date.localeCompare(b.date) || b.heat - a.heat || a.ticker.localeCompare(b.ticker)
}

function eventKey(event: DeskEvent): string {
  return `${event.ticker}-${event.date}-${event.label}-${event.detail.slice(0, 24)}`
}

function stale(read: BlotterRead | undefined, cutoff: number): boolean {
  if (!read) return true
  if (!Object.prototype.hasOwnProperty.call(read, "deepGap")) return true
  if (!Object.prototype.hasOwnProperty.call(read, "sector")) return true
  if (!Object.prototype.hasOwnProperty.call(read, "payoutLine")) return true
  if (!Object.prototype.hasOwnProperty.call(read, "events")) return true
  return Date.parse(read.readAt) < cutoff
}

export function EventCalendar({ events, ranking = false }: { events: DeskEvent[]; ranking?: boolean }) {
  const today = new Date()
  const todayIso = iso(today)
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const jumped = useRef(false)
  const start = monthStart(cursor.year, cursor.month)
  const end = monthLast(cursor.year, cursor.month)
  const inMonth = events.filter((event) => event.date >= start && event.date <= end).sort(byDate)
  const ahead = events.filter((event) => event.date >= todayIso).sort(byDate)
  const open = events.filter((event) => event.until && event.date < todayIso && event.until >= todayIso).sort(byDate)
  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay()
  const days = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)]
  while (cells.length % 7) cells.push(null)
  useEffect(() => {
    if (jumped.current || !ahead.length) return
    if (ahead.some((event) => event.date.startsWith(todayIso.slice(0, 7)))) return
    jumped.current = true
    const [year, month] = ahead[0].date.split("-").map(Number)
    setCursor({ year, month: month - 1 })
  }, [ahead, todayIso])

  const title = new Date(cursor.year, cursor.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
  const onThisMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth()
  const nextAhead = ahead[0]

  return (
    <section className="calendar-view">
      <div className="heat-scale" aria-hidden="true">
        <span>Deep blue · routine filing</span>
        <span className="heat-bar" />
        <span>Dark red · phase 3</span>
      </div>
      <div className="cal-nav">
        <button type="button" onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, -1))}>Previous</button>
        <h2>{title}</h2>
        <button type="button" onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, 1))}>Next</button>
        {onThisMonth ? null : (
          <button type="button" onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}>This month</button>
        )}
        {nextAhead && nextAhead.date.slice(0, 7) !== `${cursor.year}-${pad(cursor.month + 1)}` ? (
          <button
            type="button"
            onClick={() => {
              const [year, month] = nextAhead.date.split("-").map(Number)
              setCursor({ year, month: month - 1 })
            }}
          >
            Next date
          </button>
        ) : null}
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((day) => <div key={day} className="cal-dow">{day}</div>)}
        {cells.map((day, index) => {
          const date = day ? `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}` : ""
          const hits = day ? inMonth.filter((event) => event.date === date).sort((a, b) => b.heat - a.heat) : []
          const shown = hits.slice(0, 3)
          const tone = !day ? "blank" : date < todayIso ? "past" : date === todayIso ? "today" : ""
          return (
            <div key={date || `blank-${index}`} className={day ? `cal-day ${tone}` : "cal-day blank"}>
              {day ? <span className="cal-num">{day}</span> : null}
              {shown.map((event) => (
                <a key={eventKey(event)} className="cal-chip" style={{ background: heatColor(event.heat) }} href={`/report/${event.ticker}`} title={event.detail}>
                  <b>{event.ticker}</b> {event.label}
                </a>
              ))}
              {hits.length > shown.length ? <span className="cal-more">+{hits.length - shown.length}</span> : null}
            </div>
          )
        })}
      </div>
      <div className="section-head">
        <h2>Coming up</h2>
        <span className="eyebrow">{ahead.length ? `${ahead.length} on the watchlist` : "Watchlist"}</span>
      </div>
      {ranking && !events.length ? <p className="vintage">Reading the watchlist for dated events.</p> : null}
      {ahead.length ? (
        <ul className="event-list">
          {ahead.map((event) => (
            <EventRow key={eventKey(event)} event={event} />
          ))}
        </ul>
      ) : (
        <p className="vintage">{ranking ? "Events land here as each name is read." : "Nothing dated is still ahead on this list."}</p>
      )}
      {open.length ? (
        <section className="open-now">
          <h2>Still open</h2>
          <ul className="event-list">
            {open.map((event) => (
              <EventRow key={eventKey(event)} event={event} />
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  )
}

export function CalendarDesk({ initialIdeas }: { initialIdeas: Idea[] }) {
  const [reads, setReads] = useState<Record<string, BlotterRead>>({})
  const [ranking, setRanking] = useState(false)
  const tickerKey = initialIdeas.map((idea) => idea.ticker).join(",")

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
        const cutoff = Date.now() - 12 * 60 * 60 * 1000
        const missing = tickers.filter((ticker) => stale(have[ticker], cutoff))
        for (let index = 0; index < missing.length; index += 4) {
          if (cancel) return
          const slice = missing.slice(index, index + 4)
          const response = await fetch(apiUrl("/api/rank"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tickers: slice }),
          })
          if (!response.ok || cancel) continue
          const body = await response.json() as { reads?: Record<string, BlotterRead> }
          setReads(body.reads ?? {})
        }
      } finally {
        if (!cancel) setRanking(false)
      }
    }
    void rank()
    return () => {
      cancel = true
    }
  }, [tickerKey])

  const events = useMemo(() => {
    const rows: DeskEvent[] = []
    for (const idea of initialIdeas) {
      for (const event of reads[idea.ticker]?.events ?? []) rows.push(event)
    }
    return rows
  }, [initialIdeas, reads])

  return (
    <main className="calendar">
      <p className="kicker">Watchlist</p>
      <h1>Calendar</h1>
      <p className="lede">
        Upcoming dates on the names already on the desk. Dark red is a result that can reprice the stock, such as a phase 3 primary completion. Deep blue is a routine report date. Days that have passed are dimmed.
      </p>
      <EventCalendar events={events} ranking={ranking} />
    </main>
  )
}

function EventRow({ event }: { event: DeskEvent }) {
  return (
    <li>
      <span className="heat" style={{ background: heatColor(event.heat) }} />
      <time dateTime={event.date}>{when(event.date)}</time>
      <span>
        <a href={`/report/${event.ticker}`}><b>{event.ticker}</b> {event.label}</a>
        <span className="vintage">{event.detail}</span>
      </span>
    </li>
  )
}

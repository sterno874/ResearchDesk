import { readEntry, writeEntry } from "./persist"
import type { Idea, IdeaSource } from "./types"

const KEY = "watchlist"

export type Draft = {
  ticker: string
  name: string
  rank: number
  source: IdeaSource
}

let queue: Promise<void> = Promise.resolve()

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function read(): Promise<Idea[]> {
  const entry = await readEntry(KEY)
  if (!entry) return []
  try {
    const parsed = JSON.parse(entry.text) as unknown
    if (!Array.isArray(parsed)) return []
    return (parsed as Idea[]).map((idea) => ({ ...idea, favorite: Boolean(idea.favorite) }))
  } catch {
    return []
  }
}

async function write(ideas: Idea[]) {
  await writeEntry(KEY, JSON.stringify(ideas, null, 2))
}

function sortIdeas(ideas: Idea[]): Idea[] {
  return [...ideas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function listIdeas(): Promise<Idea[]> {
  return locked(async () => sortIdeas(await read()))
}

export function mergeDrafts(drafts: Draft[]): Promise<{ ideas: Idea[]; added: string[]; merged: number }> {
  return locked(async () => {
    const ideas = await read()
    const index = new Map(ideas.map((idea) => [idea.ticker, idea]))
    const already = new Set(ideas.map((idea) => idea.ticker))
    const added: string[] = []
    let merged = 0
    const ordered = [...drafts].sort((a, b) => b.rank - a.rank || a.ticker.localeCompare(b.ticker))
    let stamp = Date.now()
    for (const draft of ordered) {
      const existing = index.get(draft.ticker)
      const now = new Date(stamp).toISOString()
      stamp -= 1000
      if (!existing) {
        index.set(draft.ticker, {
          ticker: draft.ticker,
          name: draft.name,
          sources: [draft.source],
          addedAt: now,
          updatedAt: now,
          favorite: false,
        })
        added.push(draft.ticker)
        continue
      }
      const key = `${draft.source.kind}|${draft.source.url}|${draft.source.title}`
      const have = new Set(existing.sources.map((source) => `${source.kind}|${source.url}|${source.title}`))
      if (!have.has(key)) {
        existing.sources.push(draft.source)
        existing.sources = existing.sources.slice(0, 6)
        if (now > existing.updatedAt) existing.updatedAt = now
        if (already.has(draft.ticker)) merged += 1
      }
      if (draft.name) existing.name = draft.name
    }
    const next = sortIdeas([...index.values()]).slice(0, 80)
    await write(next)
    return { ideas: next, added, merged }
  })
}

export function addManual(ticker: string, name: string): Promise<Idea[]> {
  return mergeDrafts([
    {
      ticker,
      name,
      rank: 1,
      source: {
        kind: "manual",
        label: "Added by hand",
        title: "Put on the desk to run a report",
        url: `/report/${ticker}`,
        at: new Date().toISOString(),
      },
    },
  ]).then((result) => result.ideas)
}

export function setFavorite(ticker: string, favorite: boolean): Promise<Idea[]> {
  return locked(async () => {
    const ideas = await read()
    const idea = ideas.find((item) => item.ticker === ticker)
    if (idea) idea.favorite = favorite
    await write(ideas)
    return sortIdeas(ideas)
  })
}

export function removeIdea(ticker: string): Promise<Idea[]> {
  return locked(async () => {
    const next = (await read()).filter((idea) => idea.ticker !== ticker)
    await write(next)
    return sortIdeas(next)
  })
}

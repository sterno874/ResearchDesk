import { readEntry, writeEntry } from "./persist"
import type { BlotterRead } from "./rank"

const KEY = "ranks"
const FRESH_MS = 12 * 60 * 60 * 1000

type Store = Record<string, BlotterRead>

let queue: Promise<void> = Promise.resolve()

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function readStore(): Promise<Store> {
  const entry = await readEntry(KEY)
  if (!entry) return {}
  try {
    const parsed = JSON.parse(entry.text) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as Store
  } catch {
    return {}
  }
}

async function writeStore(store: Store) {
  await writeEntry(KEY, JSON.stringify(store))
}

export function listReads(): Promise<Record<string, BlotterRead>> {
  return locked(readStore)
}

export function saveRead(read: BlotterRead): Promise<void> {
  return locked(async () => {
    const store = await readStore()
    store[read.ticker] = read
    await writeStore(store)
  })
}

export function isFresh(read: BlotterRead, now = Date.now()): boolean {
  const at = Date.parse(read.readAt)
  if (!Number.isFinite(at) || now - at >= FRESH_MS) return false
  return Object.prototype.hasOwnProperty.call(read, "deepGap")
}

import { promises as fs } from "fs"
import path from "path"
import postgres from "postgres"

export type Entry = { text: string; updatedAt: number }

type Sql = ReturnType<typeof postgres>

let client: Sql | null = null
let ready: Promise<void> | null = null

function mode(): "db" | "disk" {
  if (process.env.DATABASE_URL) return "db"
  if (process.env.NEXT_PHASE === "phase-production-build") return "disk"
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set. The blotter and the filing cache need Postgres.")
  }
  return "disk"
}

function sql(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL is not set.")
    client = postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 15 })
  }
  return client
}

function ensure(): Promise<void> {
  if (!ready) {
    const pending = sql()`
      CREATE TABLE IF NOT EXISTS desk_object (
        key text PRIMARY KEY,
        body text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `.then(() => undefined)
    ready = pending
    pending.catch(() => {
      if (ready === pending) ready = null
    })
  }
  return ready
}

function diskPath(key: string): string {
  if (key === "watchlist") return path.join(process.cwd(), "data", "watchlist.json")
  if (key === "ranks") return path.join(process.cwd(), "data", "ranks.json")
  if (key.startsWith("cache/")) return path.join(process.cwd(), ".cache", key.slice("cache/".length))
  throw new Error(`Unknown store key ${key}`)
}

async function readDisk(key: string): Promise<Entry | null> {
  try {
    const file = diskPath(key)
    const [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)])
    return { text, updatedAt: stat.mtimeMs }
  } catch {
    return null
  }
}

async function writeDisk(key: string, text: string): Promise<void> {
  const file = diskPath(key)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text)
}

async function readDb(key: string): Promise<Entry | null> {
  await ensure()
  const rows = await sql()`SELECT body, updated_at FROM desk_object WHERE key = ${key}`
  const row = rows[0] as { body: string; updated_at: Date } | undefined
  if (!row) return null
  return { text: row.body, updatedAt: new Date(row.updated_at).getTime() }
}

async function writeDb(key: string, text: string): Promise<void> {
  await ensure()
  await sql()`
    INSERT INTO desk_object (key, body, updated_at)
    VALUES (${key}, ${text}, now())
    ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
  `
}

export function readEntry(key: string): Promise<Entry | null> {
  return mode() === "db" ? readDb(key) : readDisk(key)
}

export function writeEntry(key: string, text: string): Promise<void> {
  return mode() === "db" ? writeDb(key, text) : writeDisk(key, text)
}

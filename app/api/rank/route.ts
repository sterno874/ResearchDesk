import { NextResponse } from "next/server"
import { getReport } from "@/lib/report"
import { shorthand } from "@/lib/rank"
import { isFresh, listReads, saveRead } from "@/lib/reads"
import { normalizeTicker } from "@/lib/sec"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ reads: await listReads() })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { tickers?: string[] } | null
  const tickers = [...new Set((body?.tickers ?? []).map((ticker) => normalizeTicker(ticker)).filter(Boolean))].slice(0, 4)
  const reads = await listReads()
  for (const ticker of tickers) {
    const cached = reads[ticker]
    if (cached && isFresh(cached)) continue
    const result = await getReport(ticker)
    if (!result.ok) continue
    const read = { ...shorthand(result.report), readAt: new Date().toISOString() }
    await saveRead(read)
    reads[ticker] = read
  }
  return NextResponse.json({ reads })
}

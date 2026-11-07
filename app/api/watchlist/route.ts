import { NextResponse } from "next/server"
import { loadUniverse, normalizeTicker } from "@/lib/sec"
import { addManual, listIdeas, removeIdea, setFavorite } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ ideas: await listIdeas() })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { ticker?: string } | null
  const ticker = normalizeTicker(body?.ticker ?? "")
  if (!/^[A-Z0-9-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: "Enter a ticker like AAPL or BRK-B." }, { status: 400 })
  }
  const universe = await loadUniverse()
  const company = universe.byTicker.get(ticker)
  if (!company) {
    return NextResponse.json(
      { error: `${ticker} is not in the SEC company list, so the desk can't score it.` },
      { status: 400 },
    )
  }
  const ideas = await addManual(company.ticker, company.name)
  return NextResponse.json({ ideas })
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { ticker?: string; favorite?: boolean } | null
  const ticker = normalizeTicker(body?.ticker ?? "")
  if (!ticker) return NextResponse.json({ error: "Name the ticker to save." }, { status: 400 })
  const ideas = await setFavorite(ticker, Boolean(body?.favorite))
  return NextResponse.json({ ideas })
}

export async function DELETE(request: Request) {
  const ticker = normalizeTicker(new URL(request.url).searchParams.get("ticker") ?? "")
  const ideas = await removeIdea(ticker)
  return NextResponse.json({ ideas })
}

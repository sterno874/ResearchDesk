import { NextResponse } from "next/server"
import { getDive } from "@/lib/dive"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  const depth = Number(new URL(request.url).searchParams.get("d"))
  return NextResponse.json(await getDive(ticker, Number.isFinite(depth) && depth > 0 ? depth : 1))
}

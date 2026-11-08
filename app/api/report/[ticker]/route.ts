import { NextResponse } from "next/server"
import { getReport } from "@/lib/report"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  const fresh = new URL(request.url).searchParams.get("fresh") === "1"
  return NextResponse.json(await getReport(ticker, fresh))
}

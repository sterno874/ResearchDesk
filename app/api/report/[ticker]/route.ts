import { NextResponse } from "next/server"
import { getReport } from "@/lib/report"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  return NextResponse.json(await getReport(ticker))
}

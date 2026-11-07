import { NextResponse } from "next/server"
import { collectIdeas } from "@/lib/ideas"
import { mergeDrafts } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const { drafts, summary } = await collectIdeas()
    const merged = await mergeDrafts(drafts)
    return NextResponse.json({
      ideas: merged.ideas,
      summary: { ...summary, added: merged.added, merged: merged.merged },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collect failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

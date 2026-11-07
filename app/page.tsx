import { Desk } from "@/components/Desk"
import { researchApi } from "@/lib/remote"
import { listIdeas } from "@/lib/store"
import type { Idea } from "@/lib/types"

export const dynamic = "force-dynamic"

export default async function Page() {
  const remote = researchApi()
  let ideas: Idea[]
  if (remote) {
    const response = await fetch(`${remote}/api/watchlist`, { cache: "no-store" })
    if (!response.ok) {
      return (
        <main className="panel">
          <h1>Research Desk</h1>
          <p className="lede">The research server didn't return the blotter.</p>
        </main>
      )
    }
    const body = (await response.json()) as { ideas?: Idea[] }
    ideas = body.ideas ?? []
  } else {
    ideas = await listIdeas()
  }
  return <Desk initialIdeas={ideas} />
}

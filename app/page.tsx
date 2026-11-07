import { Desk } from "@/components/Desk"
import { listIdeas } from "@/lib/store"

export const dynamic = "force-dynamic"

export default async function Page() {
  const ideas = await listIdeas()
  return <Desk initialIdeas={ideas} />
}

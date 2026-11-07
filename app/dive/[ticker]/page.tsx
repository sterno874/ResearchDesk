import { DiveView } from "@/components/DiveView"
import { getDive } from "@/lib/dive"
import { researchApi } from "@/lib/remote"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  return { title: `${ticker.toUpperCase()} dive · Research Desk` }
}

export default async function DivePage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>
  searchParams: Promise<{ d?: string }>
}) {
  const { ticker } = await params
  const { d } = await searchParams
  const depth = Number(d)
  const level = Number.isFinite(depth) && depth > 0 ? depth : 1
  const remote = researchApi()
  const result = remote
    ? await fetch(`${remote}/api/dive/${encodeURIComponent(ticker)}?d=${level}`, { cache: "no-store" }).then((response) => response.json())
    : await getDive(ticker, level)
  if (!result.ok) {
    return (
      <main className="panel">
        <a className="back" href="/">← Desk</a>
        <h1>{result.ticker}</h1>
        <p className="lede">{result.message}</p>
      </main>
    )
  }
  return <DiveView dive={result.dive} />
}

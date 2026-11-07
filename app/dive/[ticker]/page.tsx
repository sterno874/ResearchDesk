import { DiveView } from "@/components/DiveView"
import { getDive } from "@/lib/dive"

export const dynamic = "force-dynamic"

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
  const result = await getDive(ticker, Number.isFinite(depth) && depth > 0 ? depth : 1)
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

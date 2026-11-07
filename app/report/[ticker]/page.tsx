import { ReportView } from "@/components/ReportView"
import { getReport } from "@/lib/report"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  return { title: `${ticker.toUpperCase()} · Research Desk` }
}

export default async function ReportPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  const result = await getReport(ticker)
  if (!result.ok) {
    return (
      <main className="panel">
        <a className="back" href="/">← Desk</a>
        <h1>{result.ticker}</h1>
        <p className="lede">{result.message}</p>
      </main>
    )
  }
  return <ReportView report={result.report} />
}

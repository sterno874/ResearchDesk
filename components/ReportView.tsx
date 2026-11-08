import { Pips } from "@/components/Pips"
import { gap, money, plainPct, price, ratio, when } from "@/lib/format"
import { shorthand } from "@/lib/rank"
import type { FieldBrief, InvestorScore, Metrics, Part, Report, SectorBrief, Trap } from "@/lib/types"

function tone(score: number | null): "helps" | "hurts" | "mixed" {
  if (score == null) return "mixed"
  if (score >= 6.5) return "helps"
  if (score <= 4) return "hurts"
  return "mixed"
}

function verdictClass(score: number | null): string {
  if (score == null) return "verdict mid"
  if (score >= 68) return "verdict"
  if (score >= 52) return "verdict mid"
  return "verdict low"
}

function extremes(investor: InvestorScore): { best: Part | null; worst: Part | null } {
  const scored = investor.parts.filter((item) => item.score != null)
  if (!scored.length) return { best: null, worst: null }
  const sorted = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return { best: sorted[0], worst: sorted[sorted.length - 1] }
}

function PartBlock({ item, role }: { item: Part; role?: string }) {
  const kind = tone(item.score)
  return (
    <div className="part">
      <header>
        <h3>{role ? `${role} · ${item.label}` : item.label}</h3>
        <span className="reading">{item.reading}{item.score != null ? ` · ${item.score.toFixed(1)}` : ""}</span>
      </header>
      <p>{item.note}</p>
      <div className={`bar ${kind}`} aria-hidden>
        <i style={{ width: `${((item.score ?? 0) / 10) * 100}%` }} />
      </div>
    </div>
  )
}

function Spark({ points }: { points: { close: number }[] }) {
  if (points.length < 2) return null
  const values = points.map((point) => point.close)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const width = 168
  const height = 44
  const d = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width
    const y = height - ((point.close - min) / span) * (height - 6) - 3
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(" ")
  const up = points[points.length - 1].close >= points[0].close
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" className={up ? "spark-up" : "spark-down"} strokeWidth="1.6" />
    </svg>
  )
}

function RevenueBars({ metrics }: { metrics: Metrics }) {
  const years = [...metrics.series].reverse().filter((year) => year.revenue != null)
  if (years.length < 2) return null
  const max = Math.max(...years.map((year) => year.revenue ?? 0))
  const width = 640
  const height = 88
  const gapPx = 10
  const barWidth = (width - gapPx * (years.length - 1)) / years.length
  return (
    <svg className="bars" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Revenue by fiscal year">
      {years.map((year, index) => {
        const h = ((year.revenue ?? 0) / max) * (height - 16)
        const x = index * (barWidth + gapPx)
        return <rect key={year.end} x={x} y={height - h} width={barWidth} height={h} fill="currentColor" />
      })}
    </svg>
  )
}

function TrapCard({ trap }: { trap: Trap }) {
  const paragraphs = trap.actually.split(/\n\n/)
  return (
    <article className={`trap ${trap.severity}`}>
      <h3>{trap.title}</h3>
      <p className="looks"><span>Looks like.</span> {trap.looksLike}</p>
      {paragraphs.map((paragraph) => <p key={paragraph.slice(0, 48)}>{paragraph}</p>)}
      {trap.figures.length ? (
        <div className="trap-nums">
          {trap.figures.map((figure) => (
            <div key={figure.label}>
              <span>{figure.label}</span>
              <b>{figure.value}</b>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}
function SectorSection({ sector }: { sector: SectorBrief }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{sector.label}</h2>
        <span className="eyebrow">How this sector is read</span>
      </div>
      <p className="sector-read">{sector.read}</p>
      <div className="checks">
        {sector.checks.map((item) => (
          <div className="check" key={item.label}>
            <span className="kicker">{item.label}</span>
            <b>{item.value}</b>
            <span>{item.note}</span>
          </div>
        ))}
      </div>
      {sector.studies.length ? (
        <ul className="studies">
          {sector.studies.map((study) => (
            <li key={study.id}>
              <span className="ticker">{study.phase}</span>
              <span>{study.status}{study.when !== "—" ? ` · ${study.when}` : ""}</span>
              <a href={study.url} target="_blank" rel="noreferrer">{study.title}</a>
            </li>
          ))}
        </ul>
      ) : sector.studiesNote ? <p className="vintage">{sector.studiesNote}</p> : null}
    </section>
  )
}
function FieldSection({ field }: { field: FieldBrief }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>The field</h2>
        <span className="eyebrow">{field.label}</span>
      </div>
      {field.rows.length ? (
        <div className="dive-table-wrap">
          <table className="years">
            <thead>
              <tr>
                <th>Metric</th>
                <th>This company</th>
                <th>Field median</th>
                <th>Versus the field</th>
              </tr>
            </thead>
            <tbody>
              {field.rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.company}</td>
                  <td>{row.median}</td>
                  <td>{row.sits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="vintage">{field.note}</p>
    </section>
  )
}

function metric(label: string, value: string) {
  return (
    <div className="metric" key={label}>
      <span className="kicker">{label}</span>
      <b>{value}</b>
    </div>
  )
}

export function ReportView({ report }: { report: Report }) {
  const { metrics, investors, memo, headline, history, traps } = report
  const read = shorthand(report)
  const change = metrics.changePercent
  const cells = [
    metric("Price / earnings", metrics.eps != null && metrics.eps <= 0 ? "Losses" : ratio(metrics.pe, 1) === "—" ? "—" : `${ratio(metrics.pe, 1)}×`),
    metric("Price / book", metrics.equity != null && metrics.equity <= 0 ? "Neg. equity" : metrics.pb == null ? "—" : `${ratio(metrics.pb, 1)}×`),
    metric("Free-cash-flow yield", plainPct(metrics.fcfYield, 1)),
    metric("EBIT yield", plainPct(metrics.earningsYield, 1)),
    metric("Return on equity", metrics.roe != null && metrics.roe > 1 ? plainPct(metrics.roeAvg, 0) : plainPct(metrics.roe, 0)),
    metric("Return on capital", plainPct(metrics.roic, 0)),
    metric("Operating margin", plainPct(metrics.operatingMargin, 1)),
    metric("Debt / equity", metrics.equity != null && metrics.equity <= 0 ? "Deficit" : ratio(metrics.debtToEquity)),
  ]

  return (
    <main>
      <a className="back" href="/">← Desk</a>
      <header className="identity">
        <div>
          <p className="kicker">{metrics.ticker}</p>
          <h1>{metrics.name}</h1>
          <p className="quiet">
            {metrics.fiscalYear ? `FY${metrics.fiscalYear}` : "Latest annual filing"}
            {metrics.fiscalEnd ? ` · year ended ${when(metrics.fiscalEnd)}` : ""}
            {metrics.marketCap != null ? ` · market cap ${money(metrics.marketCap, metrics.currency)}` : ""}
          </p>
        </div>
        <div className="price-block">
          <p className="price-num">{price(metrics.price, metrics.currency)}</p>
          <p className={change != null && change < 0 ? "down" : "up"}>
            {change == null ? "Price as of the latest print" : `${plainPct(change, 2)} today`}
            {metrics.asOf ? ` · ${when(metrics.asOf)}` : ""}
          </p>
          <Spark points={history} />
        </div>
      </header>

      <section className="opener">
        <p className="kicker">The company</p>
        <p>{report.company}</p>
        <p className="kicker">The play</p>
        <p className="pitch">{report.pitch}</p>
      </section>
      <p className="shorthand" title={read.why}>
        <Pips stars={read.stars} />
        <span className={`horizon ${read.horizon}`}>{read.horizonLabel}</span>
      </p>
      {read.fileNote ? <p className="file-note">{read.fileNote}</p> : null}
      <p className="reader-line">{headline}</p>
      <SectorSection sector={report.sector} />
      <p className="deeper">
        <a className="btn" href={`/dive/${metrics.ticker}`}>Kick off a deep dive</a>
        <a className="btn ghost" href={`/report/${metrics.ticker}?fresh=1`}>Refresh the filings</a>
        <span>The report is the wide cut. The dive reads the annual report, then the proxy, one level at a time. Refresh pulls the company facts, the annual report, and the proxy again.</span>
      </p>
      {report.pulledFresh ? <p className="vintage">The saved filing was set aside. Company facts, the annual report, and the proxy were pulled again for this pass.</p> : null}
      {metrics.warnings.length ? (
        <ul className="warnings">
          {metrics.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}

      {traps.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Where this looks better than it is</h2>
            <span className="eyebrow">The costume, then the filing</span>
          </div>
          {traps.map((trap) => <TrapCard key={trap.id} trap={trap} />)}
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>The numbers</h2>
          <span className="eyebrow">Today&apos;s price, last full year</span>
        </div>
        <div className="metrics">{cells}</div>
        <p className="vintage">
          {report.sector.id === "bank" || report.sector.id === "insurer"
            ? "Return on equity is earnings over equity. Price to book is the price against that equity. Cash from operations on these statements is not owner earnings."
            : report.sector.id === "reit"
              ? "Free cash flow subtracts depreciation. A REIT takes that depreciation on purpose. Funds from operations are not in this feed."
              : "Return on capital is after-tax operating income over equity plus debt minus cash. Free cash flow is cash from operations minus capital spending. Book is accounting equity, not a liquidation value."}
        </p>
      </section>

      <FieldSection field={report.field} />

      <section className="section">
        <div className="section-head">
          <h2>Six readers</h2>
          <span className="eyebrow">Same filing, different rubric</span>
        </div>
        <div className="ranks">
          {investors.map((investor) => (
            <a className="rank" href={`#${investor.id}`} key={investor.id}>
              <span>{investor.name}</span>
              <strong>{investor.score ?? "—"}</strong>
            </a>
          ))}
        </div>
      </section>

      <section className="section">
        {investors.map((investor) => {
          const { best, worst } = extremes(investor)
          const rest = investor.parts.filter((item) => item !== best && item !== worst)
          return (
            <article className="reader" id={investor.id} key={investor.id}>
              <div>
                <p className="kicker">{investor.era}</p>
                <h2>{investor.name}</h2>
                <p className="reader-score">{investor.score ?? "—"}</p>
                <p className={verdictClass(investor.score)}>{investor.verdict}</p>
              </div>
              <div>
                <p>{investor.summary}</p>
                <p className="quiet">{investor.deciding}</p>
                {best ? <PartBlock item={best} role="Attraction" /> : null}
                {worst && worst !== best ? <PartBlock item={worst} role="Objection" /> : null}
                {rest.length ? (
                  <details className="full">
                    <summary>The rest of the rubric</summary>
                    {rest.map((item) => <PartBlock item={item} key={item.id} />)}
                  </details>
                ) : null}
              </div>
            </article>
          )
        })}
      </section>

      <section className="section path">
        <div>
          <div className="section-head">
            <h2>{memo.label}</h2>
          </div>
          <p>{memo.summary}</p>
          {memo.stages.map((stage) => (
            <div className="stage" key={stage.title}>
              <time>{stage.when}</time>
              <div>
                <h3>{stage.title}</h3>
                <p>{stage.detail}</p>
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="section-head">
            <h2>Price</h2>
          </div>
          <div className="targets">
            <div className="target">
              <span className="kicker">Bear</span>
              <b>{price(memo.target.bear, metrics.currency)}</b>
              <span>{gap(memo.target.bear, metrics.price)} from here</span>
            </div>
            <div className="target base">
              <span className="kicker">Base</span>
              <b>{price(memo.target.base, metrics.currency)}</b>
              <span>{gap(memo.target.base, metrics.price)} from here</span>
            </div>
            <div className="target">
              <span className="kicker">Bull</span>
              <b>{price(memo.target.bull, metrics.currency)}</b>
              <span>{gap(memo.target.bull, metrics.price)} from here</span>
            </div>
          </div>
          {memo.target.fairNow != null && memo.kind === "compounder" ? (
            <p className="vintage">What the multiple would pay today, with no growth credit: {price(memo.target.fairNow, metrics.currency)}.</p>
          ) : null}
          <p className="method">{memo.target.method}</p>
          <ul className="assumptions">
            {memo.target.assumptions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>The years</h2>
          <span className="eyebrow">From the annual filings</span>
        </div>
        <RevenueBars metrics={metrics} />
        <table className="years">
          <thead>
            <tr>
              <th>Year ended</th>
              <th>Revenue</th>
              <th>Gross margin</th>
              <th>Operating margin</th>
              <th>Net income</th>
              <th>Equity</th>
            </tr>
          </thead>
          <tbody>
            {metrics.series.map((year) => (
              <tr key={year.end}>
                <td>{when(year.end)}{year.fy ? ` · FY${year.fy}` : ""}</td>
                <td>{money(year.revenue, metrics.statementCurrency ?? metrics.currency)}</td>
                <td>{plainPct(year.grossMargin, 1)}</td>
                <td>{plainPct(year.operatingMargin, 1)}</td>
                <td>{money(year.netIncome, metrics.statementCurrency ?? metrics.currency)}</td>
                <td>{money(year.equity, metrics.statementCurrency ?? metrics.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {metrics.filings.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Recent filings</h2>
          </div>
          <ul className="filings">
            {metrics.filings.map((filing) => (
              <li key={`${filing.form}-${filing.date}-${filing.url}`}>
                <span className="ticker">{filing.form}</span>
                <span>{when(filing.date)}</span>
                <a href={filing.url} target="_blank" rel="noreferrer">
                  {filing.description}
                  {filing.items ? ` · items ${filing.items}` : ""}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}

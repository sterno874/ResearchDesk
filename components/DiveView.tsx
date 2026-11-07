import type { Dive, DiveBlock } from "@/lib/dive"

function Block({ block }: { block: DiveBlock }) {
  if (block.type === "p") return <p>{block.text}</p>
  if (block.type === "note") return <p className="note">{block.text}</p>
  if (block.type === "figures") {
    return (
      <div className="trap-nums">
        {block.items.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <b>{item.value}</b>
          </div>
        ))}
      </div>
    )
  }
  if (block.type === "table") {
    return (
      <div className="dive-table-wrap">
        <p className="kicker">{block.caption}</p>
        <table className="dive-table">
          <thead>
            <tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join("|")}>
                {row.map((cell, index) => <td key={`${cell}-${index}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <article className="person">
      <h3>{block.name}</h3>
      <p className="quiet">{block.meta}</p>
      {block.detail ? <p>{block.detail}</p> : null}
      {block.bio ? <p>{block.bio}</p> : null}
    </article>
  )
}

export function DiveView({ dive }: { dive: Dive }) {
  return (
    <main>
      <a className="back" href={`/report/${dive.ticker}`}>← {dive.ticker} report</a>
      <header className="identity">
        <div>
          <p className="kicker">Deep dive · {dive.depth} of 7</p>
          <h1>{dive.name}</h1>
          <p className="quiet">
            Start wide, then read the annual report, then the proxy. Each level adds a document or a calculation. Nothing here is filled in from memory.
          </p>
        </div>
      </header>
      <nav className="depth" aria-label="Depth">
        {dive.steps.map((step) => step.href ? (
          <a className={step.state} href={step.href} key={step.n}>{step.n} {step.title}</a>
        ) : (
          <span className={step.state} key={step.n}>{step.n} {step.title}</span>
        ))}
      </nav>
      {dive.layers.map((layer) => (
        <section className="layer" id={`d${layer.n}`} key={layer.id}>
          <div className="section-head">
            <h2>{layer.title}</h2>
            <span className="eyebrow">Level {layer.n}</span>
          </div>
          {layer.blocks.map((block, index) => <Block block={block} key={`${layer.id}-${index}`} />)}
        </section>
      ))}
      {dive.next ? (
        <p className="deeper">
          <a className="btn" href={dive.next.href}>{dive.next.title}</a>
          <span>{dive.next.detail}</span>
        </p>
      ) : (
        <p className="note">This is the bottom of what the annual report and the proxy will support on this pass.</p>
      )}
      {dive.sources.length ? (
        <ul className="filings">
          {dive.sources.map((source) => (
            <li key={source.url}><a href={source.url}>{source.label}</a></li>
          ))}
        </ul>
      ) : null}
    </main>
  )
}

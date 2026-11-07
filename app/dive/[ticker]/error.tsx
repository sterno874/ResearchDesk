"use client"

export default function DiveError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="panel">
      <a className="back" href="/">← Desk</a>
      <h1>The deep dive didn&apos;t load</h1>
      <p className="lede">{error.message}</p>
      <button className="btn" type="button" onClick={reset}>Try again</button>
    </main>
  )
}

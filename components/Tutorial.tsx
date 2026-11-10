"use client"

import { useEffect, useId, useState } from "react"

const STEPS = [
  {
    title: "The blotter",
    body: "The home page is the list of names. Collect ideas pulls recent SEC filings, posts from the value forums, and a news search. Add is for a ticker you already have in mind. Find on the desk narrows that list by ticker or company name. Filters keep filings, earnings, forums, news, names you saved, or names with a deep-value price. An industry filter keeps one sector and combines with Deep value. Dated keeps a phase 3 completion still ahead, an open refinance window, an open-market insider buy, or a Schedule 13D, and it combines with Deep value. Deep value lists those names by how far the quote would have to move to reach that price, closest first. The stars stay the reader median. Sort by the rank, by the latest update, or by name.",
  },
  {
    title: "Five marks and a clock",
    body: "The squares beside a ticker start as the median of six readers: Buffett, Munger, Greenblatt, Klarman, Schloss, and Graham. One mark is a poor read. Five is rare. A missing piece of the profile stops the stars short: one hole stops them at 4, two at 3, and three or more at 2. The holes are a business description, the sales split, who runs it, and a statement line that never arrived. The clock is 1–2 quarters, 1–2 years, or 5–10 years, and it says no clock when the filings do not earn a date. Save is your own flag. It is not one of the five marks.",
  },
  {
    title: "The report",
    body: "Open a name. The first lines are the company, in a sentence from the annual report, and the play: the bet in the filings, with the price and the warning. Under that sit the marks, the clock, and the closest reader, with the dissent named. The numbers, the six rubrics, the path, and the recent filings follow. The calendar lists dates the filing or the trial register already has. A phase 3 primary completion is dark red. A routine report date is deep blue. The color is how much that kind of event can move the price. It does not change the stars.",
  },
  {
    title: "Where it looks better than it is",
    body: "The trap section is the costume. A cheap multiple, a good business at a full price, a pile of debt coming due. Each card says what the filing makes it look like, and what the statements actually support. A warning is named in the rank. It does not subtract an extra star.",
  },
  {
    title: "The deep dive",
    body: "Kick off a deep dive from a report, or use Deep dive on a row. It opens one level at a time and leaves the earlier levels on the page. Shape, then the business in the annual report, the unit, the trend, the field and the competitors, the people in the proxy, and the questions those documents still cannot close. You move on by clicking the next level.",
  },
  {
    title: "What a dive writes back",
    body: "Opening a report or going deeper rewrites that name on the blotter. The update time moves, so a Latest sort brings it up. From level 2 on, the row says Dive and the level. The note says whether the annual report tagged segments and whether the proxy named officers. The stars start from the median of the six readers. A hole that the dive fills comes off the cap. A hole it cannot fill stays on.",
  },
  {
    title: "Where the work runs",
    body: "This page is the screen. Collecting names, opening a report, and running a dive happen on the research server, which keeps the shared blotter and the filings it has already read. A name you add here is on that shared list.",
  },
]

export function Tutorial() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const titleId = useId()
  const current = STEPS[step]

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  function toggle() {
    setOpen((value) => {
      if (!value) setStep(0)
      return !value
    })
  }

  return (
    <div className="tutorial">
      <button className="btn ghost tutorial-btn" type="button" aria-expanded={open} onClick={toggle}>
        How to use
      </button>
      {open && current ? (
        <div className="tutorial-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}>
          <p className="kicker">Step {step + 1} of {STEPS.length}</p>
          <h2 id={titleId}>{current.title}</h2>
          <p>{current.body}</p>
          <div className="tutorial-nav">
            <button className="btn ghost" type="button" onClick={() => setStep((value) => value - 1)} disabled={step === 0}>
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button className="btn" type="button" onClick={() => setStep((value) => value + 1)}>
                Next
              </button>
            ) : (
              <button className="btn" type="button" onClick={() => setOpen(false)}>
                Done
              </button>
            )}
            <button className="btn ghost" type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

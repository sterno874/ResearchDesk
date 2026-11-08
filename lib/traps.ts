import { customersOwnShares, firstListing, halvedQuote, readCustomers, readOffering } from "./costume"
import { money, multiple, plainPct, price, when } from "./format"
import { revenueAbout } from "./metrics"
import { annualSeries, type CompanyFacts, type Submissions } from "./sec"
import type { Memo, Metrics, Trap } from "./types"

const YEAR_MS = 86400000 * 365.25

function fresh(facts: CompanyFacts, names: string[], kind: "flow" | "instant", fiscalEnd: string | null): number | null {
  const points = annualSeries(facts, names, kind)
  const point = points[0]
  if (!point) return null
  if (fiscalEnd && Date.parse(fiscalEnd) - Date.parse(point.end) > 1.4 * YEAR_MS) return null
  return point.val
}

function yearOf(end: string | null): number | null {
  if (!end) return null
  const year = Number(end.slice(0, 4))
  return Number.isFinite(year) ? year : null
}

type Bucket = { label: string; amount: number; offset: number }

function maturities(facts: CompanyFacts, fiscalEnd: string | null): Bucket[] {
  const specs = [
    ["LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths", 1],
    ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo", 2],
    ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree", 3],
    ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour", 4],
    ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive", 5],
    ["LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive", 6],
  ] as const
  const base = yearOf(fiscalEnd)
  const rows: Bucket[] = []
  for (const [name, offset] of specs) {
    const points = annualSeries(facts, [name], "instant")
    const point = points[0]
    if (!point || (fiscalEnd && point.end !== fiscalEnd)) continue
    const year = base != null ? base + offset : null
    const label = offset === 6 ? `After ${year != null ? year - 1 : "year five"}` : year != null ? String(year) : `Year ${offset}`
    if (point.val > 0) rows.push({ label, amount: point.val, offset })
  }
  return rows
}

function radioBusiness(sic: string | null, sicDescription: string | null, name: string): "terrestrial" | "satellite" | null {
  const text = `${name} ${sicDescription ?? ""}`.toLowerCase()
  if (/sirius|satellite/.test(text)) return "satellite"
  if (sic === "4832" || /radio broadcast/.test(text)) return "terrestrial"
  return null
}

function shareCount(n: number): string {
  if (n >= 1e6) {
    const millions = n / 1e6
    return `${millions >= 10 ? millions.toFixed(1) : millions.toFixed(2)} million`
  }
  return Math.round(n).toLocaleString("en-US")
}

export function buildTraps(input: {
  facts: CompanyFacts
  metrics: Metrics
  memo: Memo
  sic: string | null
  sicDescription: string | null
  submissions: Submissions | null
  history: { date: string; close: number }[]
  annualText: string
}): Trap[] {
  const { facts, metrics, memo, sic, sicDescription, submissions, history, annualText } = input
  const end = metrics.fiscalEnd
  const depreciation = fresh(facts, ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization"], "flow", end)
  const impairment = fresh(facts, ["AssetImpairmentCharges", "GoodwillAndIntangibleAssetImpairment"], "flow", end)
  const restructuring = fresh(facts, ["RestructuringCharges", "RestructuringSettlementAndImpairmentProvisions"], "flow", end)
  const interestPaid = fresh(facts, ["InterestPaidNet"], "flow", end)
  const netInterest = fresh(facts, ["InterestIncomeExpenseNonoperatingNet", "InterestExpense", "InterestExpenseDebt"], "flow", end)
  const interest = interestPaid != null && interestPaid > 0
    ? interestPaid
    : netInterest != null && netInterest < 0
      ? Math.abs(netInterest)
      : null
  const interestLabel = interestPaid != null && interestPaid > 0 ? "Cash interest paid" : "Interest cost"
  const goodwill = fresh(facts, ["Goodwill"], "instant", end)
  const finite = fresh(facts, ["FiniteLivedIntangibleAssetsNet"], "instant", end)
  const indefinite = fresh(facts, ["IndefiniteLivedIntangibleAssetsExcludingGoodwill"], "instant", end)
  const intangibles = (goodwill ?? 0) + (finite ?? 0) + (indefinite ?? 0)
  const buckets = maturities(facts, end)
  const traps: Trap[] = []

  const listing = firstListing(submissions)
  const offering = listing && annualText ? readOffering(annualText) : null
  const cut = listing ? halvedQuote(listing, metrics.price, history, offering?.price ?? null) : null
  if (listing && cut && metrics.price != null) {
    const from = cut.kind === "offering"
      ? `The annual report states an offering price of ${price(cut.from)} per ${offering?.unit ?? "share"}.`
      : `The high since the listing, in the price history, is ${price(cut.from)}.`
    const soldAfter = listing.prospectusFiled && end && listing.prospectusFiled > end
      ? ` The prospectus is dated ${when(listing.prospectusFiled)}, after the ${when(end)} statements, so the year being valued closed before the listing.`
      : end
        ? ` The year being valued ended ${when(end)}.`
        : ""
    traps.push({
      id: "fresh-listing",
      severity: "serious",
      title: "The quote is a new listing",
      looksLike: `A free-cash-flow yield of ${plainPct(metrics.fcfYield, 1)} and a value a few times the price, as if a long market had marked a known business down.`,
      actually: `The first registration on file is an ${listing.form} filed ${when(listing.filed)}. ${from} The quote is ${price(metrics.price)}.${soldAfter} Free cash flow of ${money(metrics.fcf)} is that year's figure. The no-growth value of ${price(memo.target.fairNow)} a share multiplies it by the quality multiple. A print this new, already cut from ${price(cut.from)} to ${price(metrics.price)}, is not a long market for the whole company.`,
      figures: [
        { label: cut.kind === "offering" ? "Offering price" : "High since listing", value: price(cut.from) },
        { label: "Price", value: price(metrics.price) },
        { label: "Free cash flow", value: money(metrics.fcf) },
        { label: "No-growth value", value: price(memo.target.fairNow) },
      ],
      memoLine: `The quote is a new listing that has already fallen from ${price(cut.from)} to ${price(metrics.price)}.`,
    })
  }

  const outstanding = metrics.shares
  if (listing && offering?.ordinary != null && outstanding != null && outstanding > 0) {
    const fraction = offering.ordinary / outstanding
    if (fraction < 0.15) {
      const sold = offering.sold + offering.extra
      const perAds = offering.ordinary / sold
      const ratio = offering.unit !== "ADS"
        ? ""
        : perAds === 1
          ? " Each ADS is one ordinary share."
          : ` Each ADS is ${Number.isInteger(perAds) ? String(perAds) : perAds.toFixed(2)} ordinary shares, so the quote and the ordinary-share count are different units.`
      const later = listing.prospectusFiled && end && listing.prospectusFiled > end
        ? ` The sale closed ${when(listing.prospectusFiled)}, after the ${when(end)} share count, so those shares are not in the ${shareCount(outstanding)}.`
        : ""
      traps.push({
        id: "thin-float",
        severity: cut ? "serious" : "watch",
        title: "The price covers a thin slice of the shares",
        looksLike: `An equity value of ${money(metrics.marketCap)}, as if ${price(metrics.price)} were a bid for every share.`,
        actually: `The annual report says the company sold ${shareCount(sold)} ${offering.unit === "ADS" ? "ADSs" : "shares"}.${ratio} That is ${plainPct(fraction, 1)} of the ${shareCount(outstanding)} shares outstanding on the balance sheet.${later} The quote is the price of the shares that were sold. The equity value multiplies that price by every share.`,
        figures: [
          { label: "Shares sold", value: shareCount(offering.ordinary) },
          { label: "Shares outstanding", value: shareCount(outstanding) },
          { label: "Share of the company sold", value: plainPct(fraction, 1) },
          { label: "Equity value", value: money(metrics.marketCap) },
        ],
        memoLine: "The quote prices a thin slice of the shares. The equity value applies it to the whole company.",
      })
    }
  }

  const customers = annualText ? readCustomers(annualText) : []
  const largest = customers[0]
  if (largest && (largest.share >= 0.25 || customers.reduce((sum, stake) => sum + stake.share, 0) >= 0.5)) {
    const owners = customersOwnShares(annualText, customers.map((stake) => stake.name))
    const named = customers.map((stake) => `${stake.name} ${plainPct(stake.share, 1)}`).join(", ")
    const serious = largest.share >= 0.4
    traps.push({
      id: "customer-concentration",
      severity: serious ? "serious" : "watch",
      title: "A few customers are the revenue",
      looksLike: "A full year of profit, as if the revenue were a broad book of buyers.",
      actually: `The latest annual report lists customers above a tenth of revenue: ${named}.${owners ? " The same filing says these customers are also shareholders." : ""} A year of profit that rests on that book is not a diversified stream, and the cash flow multiple does not know the names.`,
      figures: [
        ...customers.map((stake) => ({ label: stake.name, value: plainPct(stake.share, 1) })),
        { label: "Revenue", value: money(metrics.revenue) },
      ],
      memoLine: serious ? `${largest.name} is ${plainPct(largest.share, 0)} of revenue.` : undefined,
    })
  }

  const addBacks = Math.abs(impairment ?? 0) + Math.abs(restructuring ?? 0)
  const proxy = metrics.operatingIncome != null && depreciation != null
    ? metrics.operatingIncome + depreciation + addBacks
    : null
  const marketCap = metrics.marketCap
  const debt = metrics.debt
  const fcf = metrics.fcf
  const cover = fcf != null && fcf > 0 ? fcf : null

  const qualifies = (amount: number) => debt != null && amount > debt * 0.25 && (
    cover != null
      ? amount > cover * 8
      : amount > Math.max(metrics.cash ?? 0, marketCap ?? 0)
  )
  const wall = buckets
    .filter((bucket) => bucket.offset <= 5 && qualifies(bucket.amount))
    .sort((a, b) => a.offset - b.offset)[0]

  if (wall && debt != null) {
    const wallYear = Number(wall.label)
    const before = buckets.filter((bucket) => bucket.offset < wall.offset)
    const beforeAmount = before.reduce((sum, bucket) => sum + bucket.amount, 0)
    const next = buckets.find((bucket) => bucket.offset === 1)
    const schedule = buckets.map((bucket) => `${bucket.label} ${money(bucket.amount)}`).join(", ")
    const nextIsSmall = next != null && metrics.cash != null && next.amount < metrics.cash * 0.5
    const cashCoversBefore = metrics.cash != null && beforeAmount > 0 && beforeAmount <= metrics.cash
    const credit = nextIsSmall
      ? `The next twelve months of principal is ${money(next.amount)}, against ${money(metrics.cash)} of cash. That slice is a different security from the stock. A specific near-dated note can be a modest credit, and the holding-period return on short paper is modest. It does not make the equity a cinch, and this feed does not price any single note, so none is labeled one. Principal between here and the wall is ${money(beforeAmount)}${cashCoversBefore ? ", which the cash could meet, and that still is not the equity" : ", which the cash on hand does not retire by itself"}.`
      : `Principal due before the wall is ${money(beforeAmount)}. The cash on the balance sheet does not mark that as safe. Do not split a "safe note" off this stack without matching a specific issue to the cash.`
    traps.push({
      id: "maturity-wall",
      severity: "wall",
      title: "The maturity wall is the investment",
      looksLike: "A low equity value under a large stream of operating profit, so the stock looks like a fraction of a turn and the debt looks like a detail.",
      actually: `Contractual principal, from the latest annual filing: ${schedule}. The pile is ${wall.label} at ${money(wall.amount)}, against free cash flow of ${money(fcf)} and debt of ${money(debt)}. At that cash flow the principal is not being amortized. ${credit} The coupon on a refinance is not in the income statement. The bonds trade, and that price is the market's view of whether this cash can carry the stack. Results in the years before ${Number.isFinite(wallYear) ? wallYear : "the wall"} change that price, which changes the coupon, which changes whether any cash is left for the equity. The equity and the coupon are the same bet. A flat business can still leave a large residual for the stock if the refinance is tolerable, and it leaves nothing if the new interest bill takes the cash.`,
      figures: [
        ...buckets.slice(0, 6).map((bucket) => ({ label: bucket.label, value: money(bucket.amount) })),
        { label: "Debt", value: money(debt) },
        { label: "Free cash flow", value: money(fcf) },
        { label: "Cash", value: money(metrics.cash) },
      ],
      memoLine: "The maturity wall is the investment. The equity is not a cinch.",
      timeline: {
        when: Number.isFinite(wallYear) ? `${wallYear - 2}–${wallYear - 1}` : "Before the wall",
        title: "The window that sets the refinance",
        detail: `The large principal is due in ${wall.label} (${money(wall.amount)}). The filings before that are what a lender will price. Free cash flow of ${money(fcf)} does not retire ${money(debt)} of debt. A higher coupon would consume the cash the equity is supposed to own. Operating improvement matters here only because it changes the refinance, not because a higher multiple on a flat EBITDA is the thesis.`,
      },
    })
  }

  const stub = proxy != null && proxy > 0 && marketCap != null && marketCap > 0 && debt != null
    && debt > marketCap * 3
    && (interest == null || interest > proxy * 0.35)
  if (stub && proxy != null && marketCap != null) {
    const kept = fcf != null ? fcf / marketCap : null
    const costume = marketCap / proxy
    const addBackSentence = addBacks > proxy * 0.05
      ? `Getting there adds back ${money(impairment)} of impairment and ${money(restructuring)} of restructuring, on top of ${money(depreciation)} of depreciation. That add-back is not cash that arrived.`
      : `Depreciation in that figure is ${money(depreciation)}.`
    traps.push({
      id: "equity-stub",
      severity: "serious",
      title: "The yield belongs to the creditors",
      looksLike: `Equity at ${money(marketCap)} against about ${money(proxy)} of operating profit after adding non-cash charges back. That is ${multiple(costume)} equity value per dollar of that profit, the kind of number that gets called a cinch.`,
      actually: `${addBackSentence} ${interest != null ? `${interestLabel} was ${money(interest)}. ` : ""}Cash from operations, which is after interest, was ${money(metrics.cfo)}. After capital spending, free cash flow was ${money(fcf)}${kept != null ? `, a ${plainPct(kept, 1)} yield on the equity` : ""}. The huge yield appears only when cash that services the debt is assigned to the stock. You cannot find a cinch at a fraction of a turn of EBITDA outside a real dislocation, and this is not one. If the equity is owned at all, it is a single-digit percent of a portfolio. The outcomes that pay it can be large. They are not likely, and they are not the same bet as a short-dated note the cash can meet.`,
      figures: [
        { label: "Equity value", value: money(marketCap) },
        { label: "Add-back profit", value: money(proxy) },
        { label: interestLabel, value: money(interest) },
        { label: "Cash from operations", value: money(metrics.cfo) },
        { label: "Free cash flow", value: money(fcf) },
        { label: "FCF yield", value: plainPct(kept, 1) },
      ],
      memoLine: "The yield that makes this look cheap belongs to the creditors.",
    })
  }

  const revenue = metrics.revenue
  const charge = Math.abs(impairment ?? 0)
  if (revenue && charge > revenue * 0.04 && metrics.operatingIncome != null && metrics.operatingIncome < charge) {
    traps.push({
      id: "impairment-costume",
      severity: "watch",
      title: "The operating loss is mostly a write-down",
      looksLike: "An operating loss, so the business looks like it has stopped earning.",
      actually: `Asset impairment was ${money(impairment)}${restructuring ? ` and restructuring was ${money(restructuring)}` : ""}, against operating income of ${money(metrics.operatingIncome)}. Adding the write-down back changes the sentence about the year. It does not create free cash flow, it does not retire debt, and it should not be added back a second time as a future cost saving. A modernization program already in the run-rate — headcount, shared systems, vendors, occupancy — gets counted once.`,
      figures: [
        { label: "Operating income", value: money(metrics.operatingIncome) },
        { label: "Impairment", value: money(impairment) },
        { label: "Restructuring", value: money(restructuring) },
        { label: "Depreciation", value: money(depreciation) },
      ],
    })
  }

  const bookHole = metrics.equity != null && metrics.equity <= 0 && intangibles > Math.abs(metrics.equity) * 0.25
  const softBook = metrics.equity != null && metrics.equity > 0 && intangibles > metrics.equity * 0.8 && (metrics.pb ?? 99) < 1.2 && (fcf ?? 0) <= 0
  if ((bookHole || softBook) && intangibles > 0) {
    traps.push({
      id: "license-book",
      severity: "serious",
      title: "There is no book floor under the equity",
      looksLike: "A low price against assets, as if the balance sheet were a net-net or a liquidation.",
      actually: metrics.equity != null && metrics.equity <= 0
        ? `Equity is a deficit of ${money(metrics.equity)}. Goodwill is ${money(goodwill)}, finite-lived intangibles are ${money(finite)}, and indefinite-lived intangibles are ${money(indefinite)}. For a broadcaster those indefinite assets are mostly licenses. A license's carrying value is not a bid, and it is not cash you can hand a creditor. Price to book is not a margin of safety when the book is negative and the assets that remain are intangibles.`
        : `Goodwill and other intangibles are ${money(intangibles)}, against equity of ${money(metrics.equity)}. A discount to a book made of goodwill is not a discount to assets you can sell. Price to book, read that way, is the costume.`,
      figures: [
        { label: "Equity", value: money(metrics.equity) },
        { label: "Goodwill", value: money(goodwill) },
        { label: "Finite intangibles", value: money(finite) },
        { label: "Indefinite intangibles", value: money(indefinite) },
      ],
      memoLine: "Book value is not a floor under this equity.",
    })
  }

  const kind = radioBusiness(sic, sicDescription, metrics.name)
  if (kind === "satellite") {
    traps.push({
      id: "satellite-not-broadcast",
      severity: "watch",
      title: "Subscribers are not a broadcast comp",
      looksLike: "A radio company, so its subscriber trend can be borrowed as the future of terrestrial advertising.",
      actually: "This is a subscription business. The customer relationship, the demographics, and the willingness to pay are different from ad-supported terrestrial radio. Listening hours, subscriber counts, and advertising revenue do not convert into each other. Using one as the proxy for the other's decline answers a question about a different company.",
      figures: [
        { label: "Revenue", value: money(revenue) },
        { label: "Free cash flow", value: money(fcf) },
      ],
    })
  }

  if (kind === "terrestrial") {
    const earlier = revenueAbout(metrics.series, 3)
    const flat = revenue != null && earlier != null ? revenue / earlier - 1 : null
    traps.push({
      id: "radio-mechanism",
      severity: "watch",
      title: "The decline is a formula, and the total hides it",
      looksLike: "One revenue line, one decline rate, and a digital growth story that is supposed to offset it. Sometimes a satellite subscriber trend is drafted in as the comp.",
      actually: [
        "Digital and broadcast are different delivery systems: internet against terrestrial. Programmatic is not a third name for digital. It is the way inventory is booked, and it runs across both. The point of it is a higher realized price and less friction in the buy, including by putting inventory where outside buyers already work. An attribution product sits next to that. It can support fill and price. It does not create listeners.",
        "A subscription satellite service is the wrong comp. Overlap in the car is not the same customer, not the same demographic, and not the same willingness to pay. Hours listened, subscribers, and ad revenue are not convertible. Do not borrow that decline rate.",
        "Cash spot revenue is available units times the cash fill rate times the cash price per unit. The same identity in advertising terms is listening hours times ad load, times fill, times CPM. A single decline rate does not say which term moved. Hours are the term a station mostly does not control. Fill and price are the terms a programmatic pipe, and better attribution, can touch. If hours are what fell and the other two held, the company has a monetization problem sitting on a listening decline, and only the monetization is theirs to work.",
        "The listener question and the price question are different. AM/FM still takes a large share of listening minutes, and a larger share of minutes in the car, including among younger listeners. The open question is the price of those minutes against other advertising. Inserted podcast ads are the same pure-audio delivery and already price nearer television than broadcast radio does. The medium's reputation is worse than the returns advertisers measure, which is why the price can stay low and why attribution is the product. A slow lift in CPM can offset a continued decline in hours. It can also fail. Neither result goes into the case until fill or realized CPM actually moves. Share of ear by age, car versus the rest of the day, and CPM against non-primetime television are the exhibits. They are not in the consolidated XBRL, and a memo that skips them is guessing.",
        `Consolidated revenue here went from ${money(earlier)} to ${money(revenue)}${flat != null ? ` (${plainPct(flat, 1)} across that span)` : ""}. A flat total can hide a shrinking broadcast book and a growing digital book. One point of decline in the large segment does not cost the company's blended margin. It costs that segment's incremental margin, and it is offset by growth in the other segment at the other segment's incremental margin. Those incremental margins run higher than the blend, so the growth rate required to hold profit flat is lower than a blended-margin bridge says, and it falls as the shrinking segment gets smaller. This feed does not split the segments, so the bridge stops here. Using the company-wide margin overstates how much digital growth is required.`,
        "Political advertising arrives every other year. It is already understood, and it is not why a levered stub moves. Compare a political year with the previous political year. The volatility is the leverage.",
        "Further cost-out from retiring legacy telecom, centralizing master control, and automating logs and traffic is a separate leg from savings already in the run-rate. It is plausible because the back office is rules-based and a programmatic mix needs fewer local order-takers. It is an estimate until the cost line falls. A relaxation of the local-ownership cap is theoretical upside of the same kind: swaps can concentrate a cluster and remove a studio and a staff. Nothing is earned until the rule is final and a deal closes.",
      ].join("\n\n"),
      figures: [
        { label: "Revenue", value: money(revenue) },
        { label: "Change vs earlier year", value: plainPct(flat, 1) },
        { label: "Operating income", value: money(metrics.operatingIncome) },
        { label: "Cash from operations", value: money(metrics.cfo) },
      ],
    })
  }

  const base = memo.target.base
  if (
    memo.kind === "turnaround"
    && base != null
    && metrics.price != null
    && base < metrics.price * 0.85
  ) {
    traps.push({
      id: "recovery-already-priced",
      severity: "serious",
      title: "The old business is already in the price",
      looksLike: "A fallen margin at a famous franchise, so the old earnings are treated as a discounted target.",
      actually: `Restoring this company's own older margin on today's revenue still prices the stock around ${price(base)} a share, which is under the market at ${price(metrics.price)}. The bull case is the one that also needs the old sales back. A chart of what the business used to earn is not a margin of safety. Each point of the story has to be priced on its own, and margin recovery on today's sales does not clear today's price.`,
      figures: [
        { label: "Price", value: price(metrics.price) },
        { label: "Base case", value: price(base) },
        { label: "Bull case", value: price(memo.target.bull) },
        { label: "Latest margin", value: plainPct(metrics.currentOperatingMargin, 1) },
        { label: "Older margin", value: plainPct(metrics.normalOperatingMargin, 1) },
      ],
      memoLine: "Restoring the old margin does not get you to today's price.",
    })
  }

  if (
    memo.kind === "compounder"
    && metrics.fcfYield != null
    && metrics.fcfYield > 0
    && metrics.fcfYield < 0.04
    && ((metrics.roic ?? 0) > 0.15 || (metrics.operatingMargin ?? 0) > 0.2)
  ) {
    traps.push({
      id: "full-price",
      severity: "serious",
      title: "A good business at a full price",
      looksLike: "High returns and real free cash flow, so the quality of the business is treated as the margin of safety.",
      actually: `The free-cash-flow yield is ${plainPct(metrics.fcfYield, 1)}. At that price the return is the growth you are underwriting, and growth is the part that disappoints once a business is already this large. Quality is the reason the business can be owned. It is not a reason to pay any price for it. A reader who loves the returns and shrugs at the yield has skipped the only test that can fail.`,
      figures: [
        { label: "Free-cash-flow yield", value: plainPct(metrics.fcfYield, 1) },
        { label: "Return on capital", value: plainPct(metrics.roic, 0) },
        { label: "Operating margin", value: plainPct(metrics.operatingMargin, 1) },
        { label: "Fair, no growth", value: price(memo.target.fairNow) },
      ],
      memoLine: "The business is good. The price is the part that fails.",
    })
  }

  const rank = { wall: 0, serious: 1, watch: 2 }
  return traps.sort((a, b) => rank[a.severity] - rank[b.severity])
}

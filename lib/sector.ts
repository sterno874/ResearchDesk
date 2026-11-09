import { money, plainPct, price, ratio } from "./format"
import { getJson } from "./http"
import { readEntry, writeEntry } from "./persist"
import { annualSeries, tagCurrency, type CompanyFacts } from "./sec"
import type { Metrics, SectorBrief, SectorCheck, SectorId, SectorStudy } from "./types"

const DAY = 86400000

export function sectorId(sic: string | null, description: string | null): SectorId {
  const code = Number(sic)
  const text = (description ?? "").toLowerCase()
  if (Number.isFinite(code)) {
    if (code === 2836 || code === 8731) return "biotech"
    if (code >= 2830 && code < 2840) return "pharma"
    if (code >= 6020 && code < 6070) return "bank"
    if (code >= 6310 && code < 6400) return "insurer"
    if (code === 6798) return "reit"
    if (code >= 4900 && code < 5000) return "utility"
    if (code === 1311 || (code >= 1380 && code < 1390) || code === 2911 || code === 5171 || code === 5172) return "energy"
    if ((code >= 2000 && code < 2100) || (code >= 2100 && code < 2200) || (code >= 2840 && code < 2850)) return "staple"
    if (code >= 5200 && code < 6000) return "retail"
    if (code >= 7370 && code < 7380) return "software"
    if (code === 3674) return "chip"
    if (code === 3711 || code === 3714) return "auto"
    if (code === 4812 || code === 4813) return "telecom"
  }
  if (/biological|biotech/.test(text)) return "biotech"
  if (/pharmaceutical/.test(text)) return "pharma"
  if (/commercial bank|national bank|savings institution/.test(text)) return "bank"
  if (/insurance/.test(text) && !/agent|broker/.test(text)) return "insurer"
  if (/real estate investment trust/.test(text)) return "reit"
  return "operating"
}

/** A drug developer that does not yet have a multi-year profit record. The cash-flow multiple is the wrong price. */
export function developing(id: SectorId, metrics: Metrics): boolean {
  if (id !== "biotech" && id !== "pharma") return false
  const established = (metrics.revenue ?? 0) >= 500_000_000 && metrics.positiveEarningsYears >= 3
  // A missing free-cash-flow figure is not evidence that a large, profitable filer is still in development.
  if (established && (metrics.fcf == null || metrics.fcf > 0)) return false
  return metrics.positiveEarningsYears < 3 || metrics.fcf == null || metrics.fcf <= 0
}

export function skipsMultiple(id: SectorId): boolean {
  return id === "bank" || id === "insurer" || id === "reit"
}

/** Interest paid to depositors. A filing that has it is a deposit-taker even when the SIC code is not a bank. */
export function takesDeposits(facts: CompanyFacts): boolean {
  const interest = annualSeries(facts, ["InterestExpenseOnDepositsFromCustomers"], "flow")
  return (interest[0]?.val ?? 0) > 0
}

function stated(metrics: Metrics, n: number | null): string {
  return money(n, metrics.statementCurrency ?? metrics.currency)
}

function check(label: string, value: string, note: string): SectorCheck {
  return { label, value, note }
}

function runway(metrics: Metrics): SectorCheck {
  const cash = metrics.cash
  const burn = metrics.fcf != null && metrics.fcf < 0 ? -metrics.fcf : null
  const years = cash != null && burn != null && burn > 0 ? cash / burn : null
  return check(
    "Cash against the burn",
    years == null ? "—" : `${years.toFixed(1)} years`,
    years == null
      ? "Runway is cash divided by free cash flow when free cash flow is negative. One of those figures is missing, so the years are not stated."
      : `Cash is ${stated(metrics, cash)} and free cash flow is ${stated(metrics, metrics.fcf)}. At that burn the cash covers about ${years.toFixed(1)} years. A financing before then changes the share count.`,
  )
}

const STATEMENT_MS = 45 * 86400000

function onStatement(
  facts: CompanyFacts,
  name: string,
  kind: "flow" | "instant",
  fiscalEnd: string | null,
  currency: string | null,
): number | null {
  if (!fiscalEnd) return null
  const unit = tagCurrency(facts, name)
  if (!unit || unit !== (currency || "USD")) return null
  const at = Date.parse(fiscalEnd)
  if (!Number.isFinite(at)) return null
  const hit = annualSeries(facts, [name], kind).find((point) => Math.abs(Date.parse(point.end) - at) <= STATEMENT_MS)
  return hit && Number.isFinite(hit.val) ? hit.val : null
}

function firstOnStatement(
  facts: CompanyFacts,
  names: string[],
  kind: "flow" | "instant",
  fiscalEnd: string | null,
  currency: string | null,
): number | null {
  for (const name of names) {
    const value = onStatement(facts, name, kind, fiscalEnd, currency)
    if (value != null) return value
  }
  return null
}

function largestOnStatement(
  facts: CompanyFacts,
  names: string[],
  kind: "flow" | "instant",
  fiscalEnd: string | null,
  currency: string | null,
): number | null {
  let best: number | null = null
  for (const name of names) {
    const value = onStatement(facts, name, kind, fiscalEnd, currency)
    if (value == null) continue
    if (best == null || Math.abs(value) > Math.abs(best)) best = value
  }
  return best
}

function inBand(value: number | null, low: number, high: number): number | null {
  if (value == null || value < low || value > high) return null
  return value
}

type SectorMath = {
  efficiency: number | null
  expense: number | null
  interest: number | null
  fees: number | null
  loansToDeposits: number | null
  loans: number | null
  deposits: number | null
  creditCost: number | null
  provision: number | null
  chargeOffRate: number | null
  chargeOffs: number | null
  lossRatio: number | null
  claims: number | null
  premiums: number | null
  acquisitionRatio: number | null
  acquisition: number | null
  inventoryDays: number | null
  inventory: number | null
  cost: number | null
  receivableDays: number | null
  payableDays: number | null
  cashCycle: number | null
  reserveYears: number | null
  reserves: number | null
  htmLoss: number | null
  htmCarry: number | null
  htmFair: number | null
  backlogYears: number | null
  backlog: number | null
  researchShare: number | null
  research: number | null
}

function sectorMath(facts: CompanyFacts, metrics: Metrics): SectorMath {
  const end = metrics.fiscalEnd
  const currency = metrics.statementCurrency ?? metrics.currency
  const interest = onStatement(facts, "InterestIncomeExpenseNet", "flow", end, currency)
  const fees = onStatement(facts, "NoninterestIncome", "flow", end, currency)
  const expense = onStatement(facts, "NoninterestExpense", "flow", end, currency)
  const income = interest != null && fees != null ? interest + fees : null
  const efficiency = income != null && income > 0 && expense != null && expense > 0 ? inBand(expense / income, 0.2, 1.2) : null
  const loans = firstOnStatement(facts, [
    "FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss",
    "LoansAndLeasesReceivableNetReportedAmount",
  ], "instant", end, currency)
  const deposits = onStatement(facts, "Deposits", "instant", end, currency)
  const loansToDeposits = loans != null && deposits != null && loans > 0 && deposits > 0 ? inBand(loans / deposits, 0.15, 2) : null
  const provision = firstOnStatement(facts, [
    "ProvisionForLoanLeaseAndOtherLosses",
    "ProvisionForLoanAndLeaseLosses",
  ], "flow", end, currency)
  const creditCost = provision != null && loans != null && loans > 0 ? inBand(provision / loans, -0.03, 0.1) : null
  const chargeOffs = onStatement(facts, "FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossWriteoffAfterRecovery", "flow", end, currency)
  const chargeOffRate = chargeOffs != null && loans != null && loans > 0 ? inBand(chargeOffs / loans, 0, 0.08) : null
  const premiums = onStatement(facts, "PremiumsEarnedNet", "flow", end, currency)
  const claims = onStatement(facts, "PolicyholderBenefitsAndClaimsIncurredNet", "flow", end, currency)
  const lossRatio = premiums != null && premiums > 0 && claims != null ? inBand(claims / premiums, 0.15, 1.8) : null
  const acquisition = onStatement(facts, "DeferredPolicyAcquisitionCostAmortizationExpense", "flow", end, currency)
  const acquisitionRatio = acquisition != null && acquisition > 0 && premiums != null && premiums > 0
    ? inBand(acquisition / premiums, 0.02, 0.45)
    : null
  const inventory = onStatement(facts, "InventoryNet", "instant", end, currency)
  const cost = largestOnStatement(facts, ["CostOfRevenue", "CostOfGoodsAndServicesSold"], "flow", end, currency)
  const inventoryDays = inventory != null && inventory > 0 && cost != null && cost > 0 ? inBand(inventory / cost * 365, 5, 400) : null
  const receivables = firstOnStatement(facts, ["AccountsReceivableNetCurrent", "AccountsReceivableNet"], "instant", end, currency)
  const payables = onStatement(facts, "AccountsPayableCurrent", "instant", end, currency)
  const receivableDays = receivables != null && receivables > 0 && metrics.revenue != null && metrics.revenue > 0
    ? inBand(receivables / metrics.revenue * 365, 1, 200)
    : null
  const payableDays = payables != null && payables > 0 && cost != null && cost > 0
    ? inBand(payables / cost * 365, 1, 250)
    : null
  const cashCycle = inventoryDays != null && receivableDays != null && payableDays != null
    ? inBand(inventoryDays + receivableDays - payableDays, -80, 450)
    : null
  const reserves = onStatement(facts, "LiabilityForClaimsAndClaimsAdjustmentExpense", "instant", end, currency)
  const reserveYears = reserves != null && reserves > 0 && premiums != null && premiums > 0
    ? inBand(reserves / premiums, 0.3, 8)
    : null
  const htmCarry = onStatement(facts, "DebtSecuritiesHeldToMaturityExcludingAccruedInterestAfterAllowanceForCreditLoss", "instant", end, currency)
  const htmFair = onStatement(facts, "HeldToMaturitySecuritiesFairValue", "instant", end, currency)
  const htmTagged = onStatement(facts, "HeldToMaturitySecuritiesAccumulatedUnrecognizedHoldingLoss", "instant", end, currency)
  const htmGap = htmCarry != null && htmFair != null ? htmCarry - htmFair : null
  const htmLoss = htmTagged != null && htmTagged > 0 && htmGap != null && htmGap > 0
    && htmGap / htmTagged >= 0.6 && htmGap / htmTagged <= 1.4
    && metrics.equity != null && metrics.equity > 0 && htmTagged / metrics.equity >= 0.01
    ? htmTagged
    : null
  const backlog = onStatement(facts, "RevenueRemainingPerformanceObligation", "instant", end, currency)
  const backlogYears = backlog != null && backlog > 0 && metrics.revenue != null && metrics.revenue > 0
    ? inBand(backlog / metrics.revenue, 0.1, 8)
    : null
  const research = largestOnStatement(facts, [
    "ResearchAndDevelopmentExpense",
    "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
  ], "flow", end, currency)
  const researchShare = research != null && research > 0 && metrics.revenue != null && metrics.revenue > 0
    ? inBand(research / metrics.revenue, 0.02, 0.6)
    : null
  return {
    efficiency, expense, interest, fees,
    loansToDeposits, loans, deposits,
    creditCost, provision,
    chargeOffRate, chargeOffs,
    lossRatio, claims, premiums,
    acquisitionRatio, acquisition,
    inventoryDays, inventory, cost,
    receivableDays, payableDays, cashCycle,
    reserveYears, reserves,
    htmLoss, htmCarry, htmFair,
    backlogYears, backlog,
    researchShare, research,
  }
}

export type FieldFigures = {
  efficiency: number | null
  loansToDeposits: number | null
  lossRatio: number | null
  inventoryDays: number | null
  backlogYears: number | null
  researchShare: number | null
}

/** The sector ratios the field table can compare. Same statement window as the company card. */
export function fieldFigures(facts: CompanyFacts, metrics: Metrics): FieldFigures {
  const math = sectorMath(facts, metrics)
  return {
    efficiency: math.efficiency,
    loansToDeposits: math.loansToDeposits,
    lossRatio: math.lossRatio,
    inventoryDays: math.inventoryDays,
    backlogYears: math.backlogYears,
    researchShare: math.researchShare,
  }
}

function cycleCheck(math: SectorMath): SectorCheck | null {
  if (math.cashCycle == null || math.inventoryDays == null || math.receivableDays == null || math.payableDays == null) return null
  return check(
    "Cash cycle",
    `${Math.round(math.cashCycle)} days`,
    `Inventory is ${Math.round(math.inventoryDays)} days, receivables ${Math.round(math.receivableDays)} days, and payables ${Math.round(math.payableDays)} days. The cycle is how long cash is out. Same-store sales are not a tag this feed reads.`,
  )
}

function withCycle(rows: SectorCheck[], math: SectorMath): SectorCheck[] {
  const cycle = cycleCheck(math)
  if (!cycle) return rows
  const at = rows.findIndex((row) => row.label === "Free cash flow")
  if (at >= 0) rows.splice(at, 0, cycle)
  else rows.push(cycle)
  return rows
}

/** Equity per share after goodwill. Goodwill under 2% of equity is left in the book. */
export function bookAfterGoodwill(facts: CompanyFacts, metrics: Metrics): { perShare: number; goodwill: number } | null {
  const goodwill = onStatement(facts, "Goodwill", "instant", metrics.fiscalEnd, metrics.statementCurrency ?? metrics.currency)
  const equity = metrics.equity
  const book = metrics.bookPerShare
  if (goodwill == null || equity == null || book == null) return null
  if (!(goodwill > 0) || !(equity > goodwill) || !(book > 0)) return null
  if (goodwill / equity < 0.02) return null
  const perShare = book * (equity - goodwill) / equity
  return perShare > 0 ? { perShare, goodwill } : null
}

function checksFor(id: SectorId, metrics: Metrics, facts: CompanyFacts): SectorCheck[] {
  const math = sectorMath(facts, metrics)
  const margin = plainPct(metrics.grossMargin, 0)
  const op = plainPct(metrics.operatingMargin, 1)
  const years = metrics.earningsYears
    ? `${metrics.positiveEarningsYears} of ${metrics.earningsYears}`
    : "—"
  if (id === "biotech" || (id === "pharma" && developing(id, metrics))) {
    return [
      runway(metrics),
      check("Revenue", stated(metrics, metrics.revenue), "Product revenue is what turns a study into a business. A small number here means the statements are still the cash and the trials."),
      check("Years in the black", years, "A development company can be public for years before a profit. The multiple waits for that record."),
      check("Cash", stated(metrics, metrics.cash), "The cash is the time the company can keep the studies running without issuing shares."),
    ]
  }
  if (id === "pharma") {
    return [
      check("Return on capital", plainPct(metrics.roic, 0), "A drug company that already sells product is judged on the cash the current book earns."),
      check("Gross margin", margin, "The margin is the patented product. It falls when the patent clock runs out and a generic arrives."),
      check("Years in the black", years, "Several profitable years is the difference between a franchise and a single launch."),
      math.researchShare != null
        ? check("Research / sales", plainPct(math.researchShare, 0), `Research and development is ${stated(metrics, math.research)}. That spending is what has to replace the drugs already on the market.`)
        : check("Free cash flow", stated(metrics, metrics.fcf), "The studies further down are what has to replace this cash flow."),
    ]
  }
  if (id === "bank") {
    const capital = bookAfterGoodwill(facts, metrics)
    const tangibleMultiple = capital && metrics.price != null && capital.perShare > 0 ? metrics.price / capital.perShare : null
    const rows = [
      check("Price / book", metrics.pb == null ? "—" : `${ratio(metrics.pb, 2)}×`, "A bank is priced against book. The book is loans and securities, not a pile of cash you can pick up."),
      capital
        ? check("Book after goodwill", price(capital.perShare, metrics.currency), `Goodwill is ${stated(metrics, capital.goodwill)} of the equity. The deep-value price is this figure${tangibleMultiple == null ? "" : `, and the quote is ${ratio(tangibleMultiple, 2)}× it`}. Price / book above still counts the goodwill.`)
        : check("Equity", stated(metrics, metrics.equity), "This is the capital the regulators and the buyers both start from. Goodwill was not tagged on this statement, so it stays in the book."),
      check("Return on equity", plainPct(metrics.roe, 0), metrics.roeAvg != null ? `The recent average is ${plainPct(metrics.roeAvg, 0)}. One year of a high return is often a credit year, not a new franchise.` : "Equity earnings over equity. The credit cycle moves this more than a product does."),
      math.efficiency != null
        ? check("Efficiency ratio", plainPct(math.efficiency, 0), `Noninterest expense is ${stated(metrics, math.expense)} against net interest income of ${stated(metrics, math.interest)} and fee income of ${stated(metrics, math.fees)}. That is the cost of running the bank. Credit losses are not in it.`)
        : check("Net interest income", stated(metrics, math.interest), "The spread on loans and securities. Fee income is separate, and credit losses are not in it."),
      math.loansToDeposits != null
        ? check("Loans / deposits", plainPct(math.loansToDeposits, 0), `Loans are ${stated(metrics, math.loans)} and deposits are ${stated(metrics, math.deposits)}. Over 100% means the loan book is larger than the deposits and the rest is borrowed.`)
        : check("Borrowings", stated(metrics, metrics.debt), "These are the borrowings in the filing feed. A bank's deposits are its funding, and they are not the same thing as a corporate bond."),
    ]
    if (math.creditCost != null) {
      rows.push(check("Provision / loans", plainPct(math.creditCost, 2), `The provision is ${stated(metrics, math.provision)} against loans of ${stated(metrics, math.loans)}. A negative figure is a reserve release, not a new profit.`))
    }
    if (math.chargeOffRate != null) {
      rows.push(check("Charge-offs / loans", plainPct(math.chargeOffRate, 2), `Net charge-offs are ${stated(metrics, math.chargeOffs)} against loans of ${stated(metrics, math.loans)}. This is credit already written off, after recoveries. The provision is what was set aside.`))
    }
    if (math.htmLoss != null) {
      rows.push(check("Held-to-maturity loss", stated(metrics, math.htmLoss), `The carrying amount is ${stated(metrics, math.htmCarry)} and the fair value is ${stated(metrics, math.htmFair)}. That unrecognized loss is ${plainPct(metrics.equity ? math.htmLoss / metrics.equity : null, 1)} of equity. It is not deducted in book value, or in book after goodwill.`))
    }
    return rows
  }
  if (id === "insurer") {
    const rows = [
      check("Price / book", metrics.pb == null ? "—" : `${ratio(metrics.pb, 2)}×`, "An insurer is priced against book. The book includes the investment portfolio and the reserves."),
      check("Return on equity", plainPct(metrics.roe, 0), "Underwriting profit and investment income land together in this return. The feed does not split the investment book out of it."),
      math.lossRatio != null
        ? check("Claims / premiums", plainPct(math.lossRatio, 0), `Claims are ${stated(metrics, math.claims)} against premiums earned of ${stated(metrics, math.premiums)}. Investment income is not in this ratio.`)
        : check("Revenue", stated(metrics, metrics.revenue), "For an insurer this line is often premiums and investment income in one number."),
      check("Equity", stated(metrics, metrics.equity), "A cheap price on a book that is shrinking is not the same bet as a cheap price on a book that is earning."),
    ]
    if (math.acquisitionRatio != null) {
      rows.splice(3, 0, check("Acquisition costs / premiums", plainPct(math.acquisitionRatio, 1), `Policy-acquisition costs are ${stated(metrics, math.acquisition)} against premiums earned of ${stated(metrics, math.premiums)}. Adding this to claims is still not a combined ratio. Other underwriting expense is not in this tag.`))
    }
    if (math.reserveYears != null) {
      rows.push(check("Reserves / premiums", `${math.reserveYears.toFixed(1)} years`, `Unpaid claims and claim expenses are ${stated(metrics, math.reserves)} against premiums earned of ${stated(metrics, math.premiums)}. This is the stock of reserves, not the loss ratio.`))
    }
    return rows
  }
  if (id === "reit") {
    const interestExpense = onStatement(facts, "InterestExpense", "flow", metrics.fiscalEnd, metrics.statementCurrency ?? metrics.currency)
    const cover = interestExpense != null && interestExpense > 0 && metrics.revenue != null && metrics.revenue > 0
      ? inBand(metrics.revenue / interestExpense, 0.4, 30)
      : null
    return [
      check("Revenue", stated(metrics, metrics.revenue), "Rent is the business. One tenant doing a large share of it is the risk, and the customer table is where that shows up."),
      cover != null
        ? check("Revenue / interest", `${cover.toFixed(1)}×`, `Revenue is ${stated(metrics, metrics.revenue)} against interest expense of ${stated(metrics, interestExpense)}. This is not funds from operations.`)
        : check("Dividend yield", plainPct(metrics.dividendYield, 1), "A REIT's return to the holder is mostly the distribution, not a multiple on free cash flow."),
      check("Debt / equity", ratio(metrics.debtToEquity), "The buildings are financed. The question is whether the rent covers the debt when a tenant leaves."),
      check("Free cash flow", stated(metrics, metrics.fcf), "Free cash flow subtracts depreciation. A building is depreciated on purpose. Funds from operations are not a tag this feed reads, so no price is set from free cash flow."),
    ]
  }
  if (id === "utility") {
    return [
      check("Dividend yield", plainPct(metrics.dividendYield, 1), "A utility is owned for the dividend. The growth is allowed by the regulator, and it is slow."),
      check("Debt / equity", ratio(metrics.debtToEquity), "The plants are financed with debt. A higher rate changes the equity even when the customers stay."),
      check("Operating margin", op, "The margin should look dull. A sudden jump is a rate case or a one-time item, not a new product."),
      check("Revenue growth", plainPct(metrics.revenueCagr, 1), "Three quiet years are the normal record. A utility that needs a fast growth story is being asked to be a different business."),
    ]
  }
  if (id === "energy") {
    return [
      check("Operating margin", op, metrics.normalOperatingMargin != null ? `The company's own older margin is ${plainPct(metrics.normalOperatingMargin, 1)}. The difference is mostly the commodity, not a new skill.` : "The margin moves with the barrel. One fat year is not the earning power."),
      check("Revenue versus the peak", metrics.peakRevenue && metrics.revenue ? plainPct(metrics.revenue / metrics.peakRevenue - 1, 0) : "—", "Producers do not set the price. A revenue line well under the peak is a price year."),
      check("Free cash flow", stated(metrics, metrics.fcf), "Cash after the wells is the number that can pay the holder. It disappears when the price does."),
      check("Debt / equity", ratio(metrics.debtToEquity), "The balance sheet is what survives the year the commodity is down."),
    ]
  }
  if (id === "staple") {
    return [
      check("Gross margin", margin, metrics.grossMarginCv != null ? `The variation across the years on file is ${plainPct(metrics.grossMarginCv, 1)}. A staple's margin is supposed to sit still.` : "The margin is the brand. It should not need a new story every year."),
      check("Years in the black", years, "A staple that has been operating for decades should already have a run of profits. A short record is a young company in an old industry."),
      check("Dividend yield", plainPct(metrics.dividendYield, 1), "The dividend is the evidence the profit was cash. A staple that never pays one has not made the full case."),
      check("Revenue growth", plainPct(metrics.revenueCagr, 1), "Volume and price, slowly. A staple that needs a fast growth rate to work is priced as something else."),
    ]
  }
  if (id === "software") {
    const gross = metrics.grossMargin
    return [
      check("Gross margin", margin, gross != null && gross < 0.5 ? "Under 50% is a services shop or a hardware mix. It is not a software product that sells again at no extra cost." : "A software product leaves a high gross margin. That is the first split from a contract shop."),
      check("Free cash flow", stated(metrics, metrics.fcf), metrics.revenue ? `That is ${plainPct(metrics.fcf != null ? metrics.fcf / metrics.revenue : null, 0)} of revenue. Revenue that does not become cash is still a services bill.` : "Cash after the spending is the test that the revenue is real."),
      check("Revenue growth", plainPct(metrics.revenueCagr, 1), "Growth is part of the price in software. The cap in the memo still applies."),
      math.backlogYears != null
        ? check("Contracted backlog", `${math.backlogYears.toFixed(1)} years`, `The filing tags ${stated(metrics, math.backlog)} of revenue not yet recognized, against this year's sales of ${stated(metrics, metrics.revenue)}. It is contracted. It is not a forecast.`)
        : check("Years in the black", years, "A long loss record with a high gross margin is a company still buying the growth."),
    ]
  }
  if (id === "chip") {
    const spend = metrics.cfo != null && metrics.capex != null && metrics.cfo !== 0 ? metrics.capex / Math.abs(metrics.cfo) : null
    return withCycle([
      check("Gross margin", margin, "The margin says where the company sits. A designer and a factory do not earn the same gross margin."),
      check("Capital spending / cash from operations", spend == null ? "—" : plainPct(spend, 0), "A factory bill can take the cash the income statement says is there."),
      math.inventoryDays != null
        ? check("Inventory days", `${Math.round(math.inventoryDays)} days`, `Inventory is ${stated(metrics, math.inventory)} against the cost of goods of ${stated(metrics, math.cost)}. A chip cycle shows up here before it shows up in the margin.`)
        : check("Revenue, three years", plainPct(metrics.revenueChange3y, 0), "Chip revenue is a cycle. The latest year is a point on it."),
      check("Free cash flow", stated(metrics, metrics.fcf), "Cash after the factories is what an owner can take. The peak year is the wrong one to annualize."),
    ], math)
  }
  if (id === "retail") {
    return withCycle([
      check("Gross margin", margin, "Retail is the spread between what the goods cost and what the customer paid."),
      check("Operating margin", op, "After the stores and the staff. A thin operating margin has no room for a bad season."),
      math.inventoryDays != null
        ? check("Inventory days", `${Math.round(math.inventoryDays)} days`, `Inventory is ${stated(metrics, math.inventory)} against the cost of goods of ${stated(metrics, math.cost)}. Goods that stop selling sit here, and the cash does not arrive.`)
        : check("Revenue, three years", plainPct(metrics.revenueChange3y, 0), "Sales still arriving is the whole question. A concept that has stopped growing same-store is a different investment."),
      check("Free cash flow", stated(metrics, metrics.fcf), "Inventory that piles up does not show in a single margin. Cash after the year does."),
    ], math)
  }
  if (id === "auto") {
    return withCycle([
      check("Operating margin", op, metrics.normalOperatingMargin != null ? `The company's own older margin is ${plainPct(metrics.normalOperatingMargin, 1)}. Automakers earn that in a good volume year and miss it in a bad one.` : "One year's margin is a volume year, not the franchise."),
      math.inventoryDays != null
        ? check("Inventory days", `${Math.round(math.inventoryDays)} days`, `Inventory is ${stated(metrics, math.inventory)} against the cost of goods of ${stated(metrics, math.cost)}. Unsold vehicles show up here before they show up in a margin.`)
        : check("Revenue versus the peak", metrics.peakRevenue && metrics.revenue ? plainPct(metrics.revenue / metrics.peakRevenue - 1, 0) : "—", "Units and price. A year under the peak is the cycle, unless the share of the market went with it."),
      check("Debt / equity", ratio(metrics.debtToEquity), "The down year is survived with the balance sheet. A finance subsidiary's debt can sit inside this number."),
      check("Free cash flow", stated(metrics, metrics.fcf), "Cash after the tooling. A profit that the factories spend is not yet the owner's."),
    ], math)
  }
  if (id === "telecom") {
    return [
      check("Free cash flow", stated(metrics, metrics.fcf), "A network that is already built should throw off cash after the maintenance spending."),
      check("Capital spending", stated(metrics, metrics.capex), "The maintenance bill is the part of the story that keeps coming back."),
      check("Debt / equity", ratio(metrics.debtToEquity), "The network was financed. The equity is what remains after that debt."),
      check("Dividend yield", plainPct(metrics.dividendYield, 1), "The holder is paid by the dividend. A cut is the thesis breaking."),
    ]
  }
  return [
    check("Return on capital", plainPct(metrics.roic, 0), "After-tax operating income over the capital the business uses."),
    check("Free-cash-flow yield", plainPct(metrics.fcfYield, 1), "Cash after capital spending, divided by the equity value."),
    check("Years in the black", years, "A run of profits is the minimum record for an operating company."),
    check("Debt / equity", ratio(metrics.debtToEquity), "Debt is what turns a flat year into a refinance."),
  ]
}

const READ: Record<SectorId, string> = {
  biotech: "A biotechnology company is a set of studies and a pile of cash until a product is selling. The open studies below are the ones this company leads on the public trial register. What a doctor or an analyst thinks of them is not in the filing feed, so it is not invented here. An earnings multiple applies after the product has a sales record.",
  pharma: "A pharmaceutical company that already sells product is a cash-flow business with a patent clock. The statements are the current book. Research spending over sales is what has to replace that book, and the studies are the same question on the trial register. Commentary from outside the register is not in this feed.",
  bank: "A bank is loans, securities, and the equity underneath them. Cash from operations on a bank statement is not owner earnings, and a free-cash-flow multiple is the wrong price. The read is the price against book, book after goodwill when the filing tags it, the return on equity, the efficiency ratio, and the loans against the deposits. The provision is the credit set aside. Charge-offs are the credit already written off. A held-to-maturity loss is shown only when the carrying amount and the fair value are on the same statement and confirm the tagged loss. That loss is not in book value. One year of credit cost is not the franchise.",
  insurer: "An insurer is underwriting plus the investment book. Claims over premiums earned is the loss year. Acquisition costs over premiums are the cost of writing the business. Adding those two is still not a combined ratio, because other underwriting expense is a separate tag this feed often does not have. Reserves over premiums are the stock of unpaid claims. Investment income still sits in the equity return. The price is against book.",
  reit: "A real estate investment trust is rent, the debt on the buildings, and the distribution. Revenue over interest is the cover on this year's expense. Depreciation is taken on purpose, so free cash flow understates the cash. Funds from operations are not a tag this desk reads, and no price is set from the free-cash-flow multiple.",
  utility: "A utility is a regulated return and a dividend. The customers are captive and the growth is allowed, not discovered. A decade of dull margins is the record. A growth story is a different business.",
  energy: "An energy producer is a commodity price wearing a company. The margin swings with the barrel or the gas, so one year's return is not a franchise. The balance sheet is what is left when the price is down.",
  staple: "A consumer staple is a business you could have described ten years ago. The test is a gross margin that sits still and a dividend that kept being paid, not a product cycle. A short record, or a margin that jumps around, is a young company in an old industry.",
  retail: "A retailer is the spread on the goods and whether the sales are still arriving. The gross margin is the merchandise. The operating margin is what remains after the stores. Inventory days are the goods that have not sold yet. The cash cycle subtracts the payables, which is how long the company's own cash is out. Same-store sales are not a tag this feed reads.",
  chip: "A semiconductor company is a cycle plus a factory bill, unless it designs and someone else builds. The gross margin says which one. Capital spending says whether the profit survived the factories. Inventory days are where the cycle shows up before the margin does. The cash cycle puts receivables and payables next to that inventory.",
  software: "Software splits in two. A product company keeps a high gross margin because the next copy is cheap. A services shop, including contract development, does not. The gross margin is that split, and free cash flow is the check that the revenue was not just billed hours. When the filing tags it, the contracted backlog is revenue already signed and not yet recognized.",
  auto: "An automaker is a cyclical margin and a balance sheet that has to survive the down year. A finance subsidiary's borrowings can sit inside the debt. One fat volume year is not the earning power.",
  telecom: "A telecom is a network that was already built. The question is the cash left after the maintenance spending and the debt, and whether the dividend is still paid. A growth multiple is the wrong frame.",
  operating: "The filing is an operating company without a narrower class on this desk. The tests are cash earnings, the return on the capital used, and the price against that cash. A sector this desk does not yet read on its own lands here, and the general multiple is what is shown.",
}

const LABEL: Record<SectorId, string> = {
  biotech: "Biotechnology",
  pharma: "Pharmaceuticals",
  bank: "Bank",
  insurer: "Insurance",
  reit: "Real estate investment trust",
  utility: "Utility",
  energy: "Energy",
  staple: "Consumer staple",
  retail: "Retail",
  software: "Software",
  chip: "Semiconductors",
  auto: "Automaker",
  telecom: "Telecom",
  operating: "Operating company",
}

type TrialPayload = {
  studies?: {
    protocolSection?: {
      identificationModule?: { nctId?: string; briefTitle?: string }
      statusModule?: { overallStatus?: string; primaryCompletionDateStruct?: { date?: string } }
      designModule?: { phases?: string[] }
      sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } }
    }
  }[]
}

function stem(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(incorporated|inc|corp|corporation|company|co|ltd|limited|plc|holdings|group|the|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function sameSponsor(company: string, sponsor: string): boolean {
  const left = stem(company)
  const right = stem(sponsor)
  if (!left || !right) return false
  if (left.includes(right) || right.includes(left)) return true
  const head = left.split(" ")[0] ?? ""
  return head.length >= 4 && right.split(" ").includes(head)
}

async function fetchRegister(field: "lead" | "term", query: string): Promise<TrialPayload> {
  const page = field === "term" ? 50 : 20
  const url = `https://clinicaltrials.gov/api/v2/studies?query.${field}=${encodeURIComponent(query)}&filter.overallStatus=RECRUITING,ACTIVE_NOT_RECRUITING,NOT_YET_RECRUITING,ENROLLING_BY_INVITATION&pageSize=${page}&countTotal=false`
  return getJson<TrialPayload>(url, { Accept: "application/json", "User-Agent": "ResearchDesk (personal research desk; contact researchdesk@example.com)" }, 15000)
}

function pickStudies(company: string, payload: TrialPayload): SectorStudy[] {
  const studies: SectorStudy[] = []
  for (const study of payload.studies ?? []) {
    const protocol = study.protocolSection
    const sponsor = protocol?.sponsorCollaboratorsModule?.leadSponsor?.name ?? ""
    const nct = protocol?.identificationModule?.nctId ?? ""
    const title = protocol?.identificationModule?.briefTitle ?? ""
    if (!nct || !title || !sameSponsor(company, sponsor)) continue
    studies.push({
      id: nct,
      title,
      phase: phaseLabel(protocol?.designModule?.phases),
      status: statusLabel(protocol?.statusModule?.overallStatus),
      when: protocol?.statusModule?.primaryCompletionDateStruct?.date ?? "—",
      url: `https://clinicaltrials.gov/study/${nct}`,
    })
    if (studies.length >= 6) break
  }
  return studies
}

function searchWord(name: string): string {
  const words = stem(name).split(" ").filter((word) => word.length >= 4)
  return [...words].sort((a, b) => b.length - a.length)[0] ?? ""
}

function phaseLabel(phases: string[] | undefined): string {
  const named = (phases ?? []).filter((phase) => phase && phase !== "NA")
  if (!named.length) return "Not phased"
  return named
    .map((phase) => phase.replace("EARLY_PHASE1", "Early Phase 1").replace(/PHASE(\d)/, "Phase $1"))
    .join(", ")
}

function statusLabel(raw: string | undefined): string {
  if (!raw) return "—"
  return raw.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
}

async function readCached(cik: string): Promise<SectorStudy[] | null> {
  const entry = await readEntry(`cache/trials-${cik}.json`)
  if (!entry || Date.now() - entry.updatedAt > DAY) return null
  try {
    const parsed = JSON.parse(entry.text) as unknown
    return Array.isArray(parsed) ? parsed as SectorStudy[] : null
  } catch {
    return null
  }
}

/** Open studies this company leads, from the public trial register. Empty when the sector is not drugs. */
export async function loadStudies(id: SectorId, company: string, cik: string, fresh = false): Promise<{ studies: SectorStudy[]; note: string | null }> {
  if (id !== "biotech" && id !== "pharma") return { studies: [], note: null }
  const cached = fresh ? null : await readCached(cik)
  if (cached) {
    return {
      studies: cached,
      note: cached.length ? null : "No open study on the public register lists this company as the lead sponsor.",
    }
  }
  const query = searchWord(company)
  if (!query) return { studies: [], note: "The company name was too thin to search the trial register." }
  try {
    const lead = await fetchRegister("lead", query)
    let studies = pickStudies(company, lead)
    if (!studies.length) studies = pickStudies(company, await fetchRegister("term", query))
    await writeEntry(`cache/trials-${cik}.json`, JSON.stringify(studies)).catch(() => undefined)
    return {
      studies,
      note: studies.length ? null : "No open study on the public register lists this company as the lead sponsor.",
    }
  } catch {
    return { studies: [], note: "The trial register didn't load." }
  }
}

export function describeSector(
  id: SectorId,
  metrics: Metrics,
  facts: CompanyFacts,
  studies: SectorStudy[],
  studiesNote: string | null,
): SectorBrief {
  const read = id === "pharma" && developing(id, metrics) ? READ.biotech : READ[id]
  const label = id === "pharma" && developing(id, metrics) ? "Pharmaceuticals, still in development" : LABEL[id]
  return {
    id,
    label,
    read,
    checks: checksFor(id, metrics, facts),
    studies,
    studiesNote,
  }
}

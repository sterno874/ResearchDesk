export type SourceKind = "sec" | "earnings" | "forum" | "news" | "manual"

export type IdeaSource = {
  kind: SourceKind
  label: string
  title: string
  url: string
  at: string
}

export type Idea = {
  ticker: string
  name: string
  sources: IdeaSource[]
  addedAt: string
  updatedAt: string
  favorite?: boolean
}

export type CollectSummary = {
  added: string[]
  merged: number
  counts: { label: string; count: number }[]
  warnings: string[]
}

export type Filing = {
  form: string
  date: string
  description: string
  items: string
  url: string
}

export type YearPoint = {
  end: string
  fy: number | null
  revenue: number | null
  netIncome: number | null
  operatingIncome: number | null
  operatingMargin: number | null
  grossMargin: number | null
  equity: number | null
}

export type Metrics = {
  ticker: string
  name: string
  cik: string
  priced: boolean
  price: number | null
  previousClose: number | null
  changePercent: number | null
  currency: string
  /** Currency of the annual figures. Differs from `currency` when the quote cannot be mixed in. */
  statementCurrency: string | null
  asOf: string | null
  fiscalYear: number | null
  fiscalEnd: string | null
  shares: number | null
  marketCap: number | null
  enterpriseValue: number | null
  revenue: number | null
  netIncome: number | null
  eps: number | null
  operatingIncome: number | null
  grossProfit: number | null
  equity: number | null
  liabilities: number | null
  currentAssets: number | null
  currentLiabilities: number | null
  debt: number | null
  cash: number | null
  cfo: number | null
  capex: number | null
  fcf: number | null
  ownerEarnings: number | null
  pe: number | null
  pb: number | null
  fcfYield: number | null
  earningsYield: number | null
  roe: number | null
  roeAvg: number | null
  roic: number | null
  grossMargin: number | null
  operatingMargin: number | null
  currentRatio: number | null
  debtToEquity: number | null
  dividendYield: number | null
  bookPerShare: number | null
  ncavPerShare: number | null
  grahamNumber: number | null
  workingCapital: number | null
  positiveEarningsYears: number
  earningsYears: number
  shareChange5y: number | null
  revenueChange3y: number | null
  revenueCagr: number | null
  grossMarginCv: number | null
  normalOperatingMargin: number | null
  currentOperatingMargin: number | null
  priorOperatingMargin: number | null
  peakRevenue: number | null
  series: YearPoint[]
  filings: Filing[]
  filingsLoaded: boolean
  schedule13d: boolean
  insiderForms: number
  warnings: string[]
}

export type Part = {
  id: string
  label: string
  weight: number
  score: number | null
  reading: string
  note: string
}

export type InvestorScore = {
  id: string
  name: string
  era: string
  score: number | null
  verdict: string
  summary: string
  deciding: string
  parts: Part[]
}

export type Target = {
  bear: number | null
  base: number | null
  bull: number | null
  fairNow: number | null
  /** Price at which the quote would count as deep value. Separate from bear, base, and bull. */
  deep: number | null
  deepNote: string
  method: string
  assumptions: string[]
}

export type Stage = {
  when: string
  title: string
  detail: string
}

export type Memo = {
  kind: "turnaround" | "compounder" | "unclear"
  label: string
  summary: string
  stages: Stage[]
  target: Target
}

export type Trap = {
  id: string
  title: string
  severity: "wall" | "serious" | "watch"
  looksLike: string
  actually: string
  figures: { label: string; value: string }[]
  /** One sentence. Used as the headline when this is the sharpest trap. */
  memoLine?: string
  timeline?: Stage
}

export type Quote = {
  price: number
  previousClose: number | null
  changePercent: number | null
  currency: string
  asOf: string | null
  history: { date: string; close: number }[]
}

export type SectorId =
  | "biotech"
  | "pharma"
  | "bank"
  | "insurer"
  | "reit"
  | "utility"
  | "energy"
  | "staple"
  | "retail"
  | "software"
  | "chip"
  | "auto"
  | "telecom"
  | "operating"

export type SectorCheck = {
  label: string
  value: string
  note: string
}

export type SectorStudy = {
  id: string
  title: string
  phase: string
  status: string
  when: string
  url: string
}

export type SectorBrief = {
  id: SectorId
  label: string
  /** How a specialist reads this kind of business, in one paragraph. */
  read: string
  checks: SectorCheck[]
  studies: SectorStudy[]
  /** Why the study list is empty, when this sector looks them up. */
  studiesNote: string | null
}

export type FieldRow = {
  label: string
  company: string
  median: string
  /** Above, Below, In line, or a blank when the field is too thin to say. */
  sits: string
}

/** Short interest and the option chain. Not an input to the stars. */
export type Positioning = {
  shortInterest: number | null
  shortPrior: number | null
  /** Change versus the prior settlement, as a fraction. */
  shortChange: number | null
  daysToCover: number | null
  /** Short interest divided by the share count already on the report. */
  shortPercent: number | null
  settlement: string | null
  putCallVolume: number | null
  putCallOpenInterest: number | null
  note: string
}

/** This company against the largest other filers in its SIC code. Not an input to the stars. */
export type FieldBrief = {
  sic: string | null
  label: string
  peers: { ticker: string; name: string }[]
  rows: FieldRow[]
  note: string
}

export type Report = {
  metrics: Metrics
  investors: InvestorScore[]
  memo: Memo
  /** Two sentences from the annual report, or the filing class when that prose did not extract. */
  company: string
  /** The bet, in one paragraph, before any reader is named. */
  pitch: string
  headline: string
  history: { date: string; close: number }[]
  traps: Trap[]
  /** Pieces of the profile the filings did not fill. They cap the stars. */
  gaps: string[]
  sector: SectorBrief
  field: FieldBrief
  positioning: Positioning
  /** True when this pass ignored the saved facts, annual report, and proxy. */
  pulledFresh: boolean
}

export type ReportResult =
  | { ok: true; report: Report }
  | { ok: false; ticker: string; message: string }

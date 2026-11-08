export function signed(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  const body = abs.toFixed(digits)
  if (n > 0) return `+${body}`
  if (n < 0) return `−${body}`
  return body
}

export function pct(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${signed(n * 100, digits)}%`
}

export function plainPct(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const value = n * 100
  const body = Math.abs(value).toFixed(digits)
  return value < 0 ? `−${body}%` : `${body}%`
}

export function multiple(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(digits)}×`
}

export function ratio(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

export function money(n: number | null, currency = "USD"): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const sign = n < 0 ? "−" : ""
  const abs = Math.abs(n)
  const mark = currency === "USD" ? "$" : `${currency} `
  if (abs >= 1e12) return `${sign}${mark}${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sign}${mark}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${mark}${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}${mark}${(abs / 1e3).toFixed(1)}k`
  return `${sign}${mark}${abs.toFixed(0)}`
}

export function count(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const sign = n < 0 ? "−" : ""
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}k`
  return `${sign}${abs.toFixed(0)}`
}

export function price(n: number | null, currency = "USD"): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const sign = n < 0 ? "−" : ""
  const abs = Math.abs(n)
  const mark = currency === "USD" ? "$" : `${currency} `
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 2 : abs >= 1 ? 2 : 3
  return `${sign}${mark}${abs.toFixed(digits)}`
}

function calendarDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export function when(iso: string | null): string {
  if (!iso) return "—"
  const date = calendarDate(iso) ?? new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function monthYear(iso: string): string {
  const date = calendarDate(iso) ?? new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

export function addMonths(months: number, from = new Date()): string {
  const date = new Date(from)
  date.setMonth(date.getMonth() + months)
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

export function gap(target: number | null, current: number | null): string {
  if (target == null || current == null || current === 0) return "—"
  return pct(target / current - 1, 0)
}

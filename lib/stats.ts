export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function round(n: number, places = 1): number {
  const factor = 10 ** places
  return Math.round(n * factor) / factor
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function stdev(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length
  const variance = values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/** Coefficient of variation. Needs a handful of years so one odd print can't fake stability. */
export function cv(values: number[]): number | null {
  if (values.length < 4) return null
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length
  if (Math.abs(mean) < 1e-9) return null
  const deviation = stdev(values)
  if (deviation == null) return null
  return Math.abs(deviation / mean)
}

/** Piecewise linear map. Outside the end anchors, the score stays at that anchor. */
export function scale(value: number, points: { at: number; score: number }[]): number {
  const pts = [...points].sort((a, b) => a.at - b.at)
  if (value <= pts[0].at) return pts[0].score
  const last = pts[pts.length - 1]
  if (value >= last.at) return last.score
  for (let i = 0; i < pts.length - 1; i++) {
    const left = pts[i]
    const right = pts[i + 1]
    if (value >= left.at && value <= right.at) {
      const span = right.at - left.at || 1
      const t = (value - left.at) / span
      return left.score + t * (right.score - left.score)
    }
  }
  return last.score
}

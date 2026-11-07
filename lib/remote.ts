/** Set on Vercel. Empty on the Oracle machine, which is the research server. */
export function researchApi(): string {
  return (process.env.NEXT_PUBLIC_RESEARCH_API || "").replace(/\/$/, "")
}

export function apiUrl(path: string): string {
  const base = researchApi()
  return base ? `${base}${path}` : path
}

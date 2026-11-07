export const SEC_HEADERS = {
  "User-Agent": "ResearchDesk (personal research desk; contact researchdesk@example.com)",
  Accept: "application/json",
}

export async function getJson<T>(url: string, headers: Record<string, string>, timeoutMs = 25000): Promise<T> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  })
  if (!response.ok) {
    let host = url
    try {
      host = new URL(url).host
    } catch {
      host = url
    }
    throw new Error(`${response.status} from ${host}`)
  }
  return (await response.json()) as T
}

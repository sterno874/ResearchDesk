export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  const decoded = stripped
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits)
      return code > 0 && code < 65536 ? String.fromCharCode(code) : " "
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = parseInt(hex, 16)
      return code > 0 && code < 65536 ? String.fromCharCode(code) : " "
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
  return decoded.replace(/\s+/g, " ").trim()
}

export function sentenceAround(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return ""
  const start = Math.max(text.lastIndexOf(". ", at), text.lastIndexOf("! ", at))
  const from = start >= 0 ? start + 2 : Math.max(0, at - 40)
  const end = text.indexOf(". ", at + needle.length)
  return text.slice(from, end > from ? end + 1 : Math.min(text.length, at + 420)).trim()
}

const ABBREVIATION = /(?:Inc|Corp|Co|Ltd|LLC|L\.L\.C|U\.S|U\.K|Mr|Ms|Mrs|Dr|Jr|Sr|No|St|vs|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|a\.m|p\.m)$/i

/** Split on sentence endings, and leave "Inc." and "J." attached to the sentence they belong to. */
export function splitSentences(text: string): string[] {
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const mark = text[i]
    if (mark !== "." && mark !== "!" && mark !== "?") continue
    const next = text[i + 1]
    if (next && next !== " ") continue
    if (mark === ".") {
      const word = text.slice(Math.max(0, i - 10), i)
      if (ABBREVIATION.test(word) || /(?:^|\s)[A-Z]$/.test(word)) continue
    }
    const piece = text.slice(start, i + 1).trim()
    if (piece) parts.push(piece)
    start = i + 1
    while (text[start] === " ") start += 1
    i = start - 1
  }
  const rest = text.slice(start).trim()
  if (rest) parts.push(rest)
  return parts
}

export function sentences(text: string, count: number): string {
  return splitSentences(text).filter(Boolean).slice(0, count).join(" ")
}

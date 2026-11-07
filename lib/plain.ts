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

export function sentences(text: string, count: number): string {
  const parts = text.split(/(?<=\.)\s+/).map((part) => part.trim()).filter(Boolean)
  return parts.slice(0, count).join(" ")
}

import type { Metadata } from "next"
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google"
import { Tutorial } from "@/components/Tutorial"
import "./globals.css"

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" })
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: "Research Desk",
  description: "A shared desk for reading a business from the filings, with a blotter, a memo, and a path.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>
        <div className="shell">
          <header className="top">
            <a className="brand" href="/">
              <span className="brand-mark">RD</span>
              <span>
                <span className="kicker">Partnership research</span>
                <span className="brand-name">Research Desk</span>
              </span>
            </a>
            <div className="top-actions">
              <Tutorial />
              <p className="session">Filings · Price · Rubric</p>
            </div>
          </header>
          {children}
          <footer className="foot">
            Mechanical readings of public filings and a live price. Not a recommendation, not those investors&apos; opinions, and not a date the market owes you.
          </footer>
        </div>
      </body>
    </html>
  )
}

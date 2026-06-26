import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { site } from "@/lib/site";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { ScrollProgress } from "@/components/scroll-progress";
import "./globals.css";

// Display — modern, classy grotesk with character.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

// Editorial serif accent — used italic for emphasis / pull-quotes.
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.title} — ${site.tagline}`,
    template: `%s — ${site.title}`,
  },
  description: site.description,
  keywords: [
    "confidential computing",
    "private smart contracts",
    "MPC",
    "multi-party computation",
    "Base",
    "Ethereum",
    "front-running protection",
    "encrypted inputs",
    "threshold signatures",
  ],
  openGraph: {
    title: `${site.title} — ${site.tagline}`,
    description: site.description,
    url: site.url,
    siteName: site.title,
    type: "website",
  },
  twitter: { card: "summary_large_image", title: site.title, description: site.description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${bricolage.variable} ${instrument.variable} dark`}
    >
      <body className="min-h-screen antialiased">
        <ScrollProgress />
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}

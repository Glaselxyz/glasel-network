# Confide Network — web

The documentation and developer site for the Confide Network. Built with
**Next.js 14 (App Router)**, **Tailwind CSS**, and **MDX** (syntax highlighting via
`rehype-pretty-code` + Shiki).

## Develop

```bash
pnpm install      # or npm install
pnpm dev          # http://localhost:3000
```

## Build

```bash
pnpm build
pnpm start
```

## Structure

```
src/
  app/
    page.tsx              landing page
    docs/
      layout.tsx          docs shell (sidebar + TOC + pager)
      **/page.mdx         content pages (Introduction, Quickstart, …)
  components/             nav, footer, code window, callouts, diagrams
  lib/site.ts             nav config + live contract addresses
mdx-components.tsx        MDX element → component mapping
```

## Theme & fonts

Monochrome (pure black, white, grayscale), tuned for readability + a luxurious,
clean feel. Headings use **Argent Pixel CF** (Adobe Fonts) with **Fraunces**
(free, self-hosted via `next/font`) as the fallback; body/UI use **Inter**; code
and technical labels use **IBM Plex Mono**.

To load the real Argent Pixel CF, create an Adobe Fonts web project that includes
it and set its kit URL:

```bash
# .env.local
NEXT_PUBLIC_TYPEKIT_CSS=https://use.typekit.net/xxxxxxx.css
```

Without it the site renders in the Playfair fallback. Design tokens live in
`src/app/globals.css` (`--font-display`, `--font-mono`, colors); the grayscale
ramp is in `tailwind.config.ts`.

## Content

Docs content is authored in MDX under `src/app/docs/**`. The sidebar and
prev/next pager are driven by `docsNav` in `src/lib/site.ts` — add a page by
creating a `page.mdx` and a nav entry. Live deployment addresses also live in
`src/lib/site.ts` (mirrors `../docs/TESTNET.md`).

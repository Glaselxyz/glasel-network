export type Post = {
  slug: string;
  title: string;
  description: string;
  /** ISO date, e.g. "2026-07-12". */
  date: string;
  author: string;
  readingTime: string;
  tag: string;
};

/** Newest first. The index and the prev/next pager read from this list. */
export const posts: Post[] = [
  {
    slug: "repointing-a-live-network-at-a-new-token",
    title: "Repointing a live network at a new token — without taking it down",
    description:
      "A developer's play-by-play of migrating Glasel's live confidential network onto the public GLS token: which contracts actually had to change, the one scary question, and the on-chain proof it worked — every step with a transaction link.",
    date: "2026-07-12",
    author: "The Glasel team",
    readingTime: "9 min read",
    tag: "Engineering",
  },
  {
    slug: "sealed-order-confidential-app",
    title: "Build your first confidential app: a sealed order the chain can't read",
    description:
      "A hands-on, end-to-end guide to encrypting a value, computing on it while it stays sealed, and reading back a result only you can decrypt — running live on Robinhood Chain.",
    date: "2026-07-12",
    author: "The Glasel team",
    readingTime: "11 min read",
    tag: "Tutorial",
  },
];

export const postBySlug = (slug: string) => posts.find((p) => p.slug === slug);

/** "2026-07-12" -> "July 12, 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatDate } from "@/lib/blog";

/**
 * Byline rendered at the top of each blog post (inside the MDX, above the H1's
 * content). The layout supplies the prose wrapper + TOC; this supplies the
 * "back to blog", tag, date, author, and reading-time line.
 */
export function PostHeader({
  tag,
  date,
  author,
  readingTime,
}: {
  tag: string;
  date: string;
  author: string;
  readingTime: string;
}) {
  return (
    <div className="not-prose mb-8">
      <Link
        href="/blog"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All posts
      </Link>
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-faint">
        <span className="badge">{tag}</span>
        <time dateTime={date}>{formatDate(date)}</time>
        <span aria-hidden>·</span>
        <span>{author}</span>
        <span aria-hidden>·</span>
        <span>{readingTime}</span>
      </div>
    </div>
  );
}

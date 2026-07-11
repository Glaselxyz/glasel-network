import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { posts, formatDate } from "@/lib/blog";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Blog — Glasel",
  description:
    "Guides and deep-dives on building confidential applications with Glasel — encrypted inputs, MPC, and threshold-verified results on a public chain.",
};

export default function BlogIndex() {
  const [featured, ...rest] = posts;

  return (
    <div className="container-page py-16">
      <div className="mx-auto max-w-3xl">
        <div className="eyebrow-line mb-3 text-xs font-semibold uppercase tracking-wider text-cyan">
          Blog
        </div>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Building in the open
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">
          Hands-on guides to writing apps that compute on data they never see —
          live on {site.networkLabel}.
        </p>
      </div>

      <div className="mx-auto mt-14 max-w-3xl space-y-5">
        {featured && (
          <Link
            href={`/blog/${featured.slug}`}
            className="card group block overflow-hidden p-7 transition-colors hover:bg-panel sm:p-9"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
              <span className="badge">{featured.tag}</span>
              <time dateTime={featured.date}>{formatDate(featured.date)}</time>
              <span aria-hidden>·</span>
              <span>{featured.readingTime}</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold leading-snug text-white transition-colors group-hover:text-cyan">
              {featured.title}
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">{featured.description}</p>
            <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-cyan">
              Read the guide
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        )}

        {rest.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="card group block p-6 transition-colors hover:bg-panel"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
              <span className="badge">{post.tag}</span>
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span aria-hidden>·</span>
              <span>{post.readingTime}</span>
            </div>
            <h2 className="mt-3 text-xl font-semibold leading-snug text-white transition-colors group-hover:text-cyan">
              {post.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{post.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

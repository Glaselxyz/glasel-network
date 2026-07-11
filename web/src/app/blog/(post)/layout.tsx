import { TableOfContents } from "@/components/toc";

/**
 * Shell for a single blog post. The route group `(post)` keeps this off the
 * `/blog` index — only individual articles get the prose + TOC chrome. Each
 * post's MDX supplies its own <PostHeader/> byline and H1.
 */
export default function BlogPostLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page grid gap-10 py-12 xl:grid-cols-[minmax(0,1fr)_200px]">
      <div className="mx-auto w-full min-w-0 max-w-2xl">
        <article className="prose">{children}</article>
      </div>
      <aside className="hidden xl:block">
        <TableOfContents />
      </aside>
    </div>
  );
}

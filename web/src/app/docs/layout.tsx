import { DocsSidebar } from "@/components/docs-sidebar";
import { TableOfContents } from "@/components/toc";
import { DocsPager } from "@/components/docs-pager";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page grid gap-10 py-10 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_200px]">
      {/* left nav */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-10 pr-2">
          <DocsSidebar />
        </div>
      </aside>

      {/* content */}
      <div className="min-w-0">
        <article className="prose">{children}</article>
        <DocsPager />
      </div>

      {/* toc */}
      <aside className="hidden xl:block">
        <TableOfContents />
      </aside>
    </div>
  );
}

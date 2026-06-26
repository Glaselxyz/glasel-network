import { codeToHtml } from "shiki";
import { CopyButton } from "./copy-button";
import { cn } from "@/lib/utils";

export async function CodeWindow({
  code,
  lang = "typescript",
  filename,
  className,
}: {
  code: string;
  lang?: string;
  filename?: string;
  className?: string;
}) {
  const html = await codeToHtml(code.trim(), {
    lang,
    theme: "github-dark-default",
    transformers: [
      {
        pre(node) {
          node.properties.style = "background:transparent;padding:0;margin:0;";
        },
      },
    ],
  });

  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ background: "var(--panel-2)" }}>
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3e8fe6" }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#6fe9ff" }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#6fe9ff" }} />
          </span>
          {filename && <span className="ml-2 font-mono text-xs text-muted">{filename}</span>}
        </div>
        <CopyButton text={code.trim()} />
      </div>
      <div
        className="overflow-x-auto p-4 text-[13px] leading-relaxed [&_code]:font-mono"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

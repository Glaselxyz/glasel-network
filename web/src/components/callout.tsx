import { Info, TriangleAlert, Lightbulb, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const styles = {
  note: { icon: Info, ring: "rgba(62,143,230,0.4)", bg: "rgba(62,143,230,0.1)", color: "#6fe9ff" },
  tip: { icon: Lightbulb, ring: "rgba(111,233,255,0.4)", bg: "rgba(111,233,255,0.08)", color: "#6fe9ff" },
  warning: { icon: TriangleAlert, ring: "rgba(163,240,255,0.45)", bg: "rgba(163,240,255,0.1)", color: "#a3f0ff" },
  security: { icon: ShieldCheck, ring: "rgba(62,143,230,0.45)", bg: "rgba(62,143,230,0.1)", color: "#a3f0ff" },
};

export function Callout({
  type = "note",
  title,
  children,
}: {
  type?: keyof typeof styles;
  title?: string;
  children: React.ReactNode;
}) {
  const s = styles[type];
  const Icon = s.icon;
  return (
    <div
      className={cn("my-5 flex gap-3 rounded-xl border p-4 text-sm")}
      style={{ borderColor: s.ring, background: s.bg }}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: s.color }} />
      <div className="[&>p]:my-0 [&>p+p]:mt-2 leading-relaxed text-[#c4c4d0]">
        {title && (
          <div className="mb-1 font-semibold" style={{ color: s.color }}>
            {title}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

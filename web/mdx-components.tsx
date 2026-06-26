import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { Pre } from "@/components/mdx-pre";
import { Callout } from "@/components/callout";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    pre: (props) => <Pre {...props} />,
    a: ({ href = "", ...props }) => {
      const internal = href.startsWith("/") || href.startsWith("#");
      if (internal) return <Link href={href} {...props} />;
      return <a href={href} target="_blank" rel="noreferrer" {...props} />;
    },
    Callout,
    ...components,
  };
}

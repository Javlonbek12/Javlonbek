"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type HelpLink = { href: string; label: string };

// «Label» of a page the answer links to becomes a link; **word** becomes bold.
function inline(text: string, links: HelpLink[], onLink?: () => void): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|«[^»]+»)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("«")) {
      const link = links.find((l) => l.label.toLowerCase() === part.slice(1, -1).toLowerCase());
      if (link)
        return (
          <Link
            key={i}
            href={link.href}
            onClick={onLink}
            className="text-primary font-medium underline-offset-2 hover:underline"
          >
            {part}
          </Link>
        );
    }
    return part;
  });
}

type Block = { kind: "p" | "ol" | "ul"; lines: string[]; start?: number };

const ORDERED = /^(\d+)[.)]\s+/;
const BULLET = /^[-•*]\s+/;

function blocks(text: string): Block[] {
  const result: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const last = result.at(-1);
    if (!line) {
      result.push({ kind: "p", lines: [] });
      continue;
    }
    const ordered = ORDERED.exec(line);
    const kind = ordered ? "ol" : BULLET.test(line) ? "ul" : "p";
    const content = line.replace(ordered ? ORDERED : BULLET, "");
    if (last && last.kind === kind && (kind !== "p" || last.lines.length > 0))
      last.lines.push(content);
    else result.push({ kind, lines: [content], start: ordered ? Number(ordered[1]) : undefined });
  }
  return result.filter((block) => block.lines.length > 0);
}

// An answer of the help assistant: short paragraphs, numbered steps and bullets, with the
// pages it names linked.
export function HelpText({
  text,
  links = [],
  onLink,
}: {
  text: string;
  links?: HelpLink[];
  onLink?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {blocks(text).map((block, i) => {
        const items = block.lines.map((line, j) => <li key={j}>{inline(line, links, onLink)}</li>);
        if (block.kind === "ol")
          return (
            <ol key={i} start={block.start} className="flex list-decimal flex-col gap-1 pl-5">
              {items}
            </ol>
          );
        if (block.kind === "ul")
          return (
            <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
              {items}
            </ul>
          );
        return <p key={i}>{inline(block.lines.join(" "), links, onLink)}</p>;
      })}
    </div>
  );
}

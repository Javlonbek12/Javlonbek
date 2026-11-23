import { ownerOf, type Hierarchy } from "./hierarchy";
import { titleKey } from "./parse";
import type { FollowUps, Recovery } from "./recovery";
import type { TsmRow } from "./visits";

// «Требует внимания»: the TSMs whose numbers are below the line, each with the reasons and their
// numbers, the worst first — so a manager sees who to talk to and about what (rules of 23.11.2026,
// see docs/DECISIONS.md). Pure functions: the numbers come from the page's other blocks.

export const ATTENTION_RULES = {
  // Connect used on fewer than this share (%) of the planned stores visited.
  connect: { below: 70 },
  // Fewer than this share (%) of the products that were out came back, of at least `min` compared.
  recovery: { below: 15, min: 10 },
  // Fewer than this share (%) of the checks with an OOS were followed by a rep's order, of at
  // least `min` checks counted.
  followUp: { below: 50, min: 10 },
  // This many auto-stock orders (or more) with nothing sold in a closed window.
  unsold: { from: 3 },
  // Fewer than this share (%) of the planned visits made (route analysis).
  attendance: { below: 85 },
} as const;

export const ATTENTION_KINDS = ["connect", "recovery", "followUp", "unsold", "attendance"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

// The rows shown on the page; the whole list is in the Excel file.
export const ATTENTION_SHOWN = 10;

export type AttentionReason = {
  kind: AttentionKind;
  // The number the rule looks at (a share in %, or orders for `unsold`) and what it is of (visits,
  // products, checks, orders checked; null when not known).
  value: number;
  of: number | null;
  // How far past the line, 0..1.
  severity: number;
};

export type AttentionRow = {
  code: string;
  name: string | null;
  // The person of the position above (and its title), by the employee info.
  manager: { name: string | null; title: string } | null;
  reasons: AttentionReason[];
  score: number;
};

// The position above a TSM's own: its person (the first named) and title.
export function managerOf(hierarchy: Hierarchy | null | undefined, code: string) {
  if (!hierarchy) return null;
  const own = ownerOf(hierarchy, code);
  const parent = own ? hierarchy.nodes.get(own)?.parent : null;
  const node = parent ? hierarchy.nodes.get(parent) : null;
  if (!node) return null;
  return { name: node.positions.find((p) => p.user)?.user ?? null, title: node.title };
}

// A share under the line: the further under, the worse.
const below = (value: number, line: number) => Math.min(1, Math.max(0, (line - value) / line));

export function attentionList(input: {
  // The TSMs to look at (those the viewer may see).
  rows: Pick<TsmRow, "code" | "name" | "visited" | "connectRate" | "sales">[];
  recovery?: Recovery["byTsm"] | null;
  followUp?: FollowUps["byTsm"] | null;
  // Sales are loaded: the cross-check of orders counts.
  sales?: boolean;
  // Planned visits made, % by TSM code (the route analysis); without it the rule is skipped.
  attendance?: Map<string, number> | null;
  hierarchy?: Hierarchy | null;
}): AttentionRow[] {
  const R = ATTENTION_RULES;
  const byCode = <T extends { code: string }>(list: T[] | null | undefined) =>
    new Map((list ?? []).map((item) => [titleKey(item.code), item]));
  const recovery = byCode(input.recovery);
  const followUp = byCode(input.followUp);
  const attendance = new Map(
    [...(input.attendance ?? [])].map(([code, value]) => [titleKey(code), value]),
  );

  const rows: AttentionRow[] = [];
  for (const row of input.rows) {
    const key = titleKey(row.code);
    const reasons: AttentionReason[] = [];
    const add = (kind: AttentionKind, value: number, of: number | null, severity: number) =>
      reasons.push({ kind, value, of, severity });

    if (row.visited > 0 && row.connectRate < R.connect.below)
      add("connect", row.connectRate, row.visited, below(row.connectRate, R.connect.below));

    const restored = recovery.get(key);
    if (restored && restored.rate !== null && restored.wasOut >= R.recovery.min) {
      if (restored.rate < R.recovery.below)
        add("recovery", restored.rate, restored.wasOut, below(restored.rate, R.recovery.below));
    }

    const followed = followUp.get(key);
    if (followed && followed.rate !== null && followed.checks >= R.followUp.min) {
      if (followed.rate < R.followUp.below)
        add("followUp", followed.rate, followed.checks, below(followed.rate, R.followUp.below));
    }

    const unsold = input.sales ? row.sales.checked - row.sales.anySold : 0;
    if (unsold >= R.unsold.from)
      add("unsold", unsold, row.sales.checked, Math.min(1, unsold / (R.unsold.from * 2)));

    const visited = attendance.get(key);
    if (visited !== undefined && visited < R.attendance.below)
      add("attendance", visited, null, below(visited, R.attendance.below));

    if (!reasons.length) continue;
    rows.push({
      code: row.code,
      name: row.name,
      manager: managerOf(input.hierarchy, row.code),
      reasons,
      score: reasons.reduce((a, r) => a + r.severity, 0),
    });
  }
  // The most reasons first, then the furthest past the lines.
  return rows.sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      b.score - a.score ||
      a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
}

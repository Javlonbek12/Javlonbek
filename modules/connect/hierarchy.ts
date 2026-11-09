import { titleKey, type PositionRecord } from "./parse";
import { aggregateRows, type RowTotals, type TsmRow } from "./visits";

// Who reports to whom, from the CRM's employee info (rules approved by the owner on 09.11.2026,
// see docs/DECISIONS.md), as pure functions. A position names the title of the position above it;
// titles are compared by titleKey. A manager title that is not a row of its own is still a node
// (no person). A link that would close a cycle is dropped: that position becomes a top node.

export type PositionNode = {
  key: string;
  // As first written (a row's title, else the manager title naming it).
  title: string;
  // Usually one; none for a manager title without a row; more when the file repeats a title.
  positions: PositionRecord[];
  parent: string | null;
  children: string[];
  depth: number;
  order: number;
};

export type Hierarchy = {
  nodes: Map<string, PositionNode>;
  roots: string[];
  // Which node a TSM code belongs to (by titleKey): the position with that title, else the
  // deepest position whose working zones list it. `label` is the code as written there.
  owners: Map<string, { node: string; label: string }>;
};

const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function buildHierarchy(positions: PositionRecord[]): Hierarchy {
  const nodes = new Map<string, PositionNode>();
  const node = (title: string) => {
    const key = titleKey(title);
    let n = nodes.get(key);
    if (!n) {
      n = { key, title, positions: [], parent: null, children: [], depth: 0, order: nodes.size };
      nodes.set(key, n);
    }
    return n;
  };
  for (const p of positions) node(p.title).positions.push(p);
  for (const p of positions) if (p.manager) node(p.manager);

  // Parents in file order; the link that would close a cycle is left out.
  const closesCycle = (child: string, parent: string) => {
    for (let at: string | null = parent; at; at = nodes.get(at)!.parent)
      if (at === child) return true;
    return false;
  };
  for (const n of nodes.values()) {
    const manager = n.positions.find((p) => p.manager)?.manager;
    const parent = manager ? titleKey(manager) : null;
    if (parent && !closesCycle(n.key, parent)) n.parent = parent;
  }
  for (const n of nodes.values()) if (n.parent) nodes.get(n.parent)!.children.push(n.key);
  const byTitle = (a: string, b: string) => natural(nodes.get(a)!.title, nodes.get(b)!.title);
  for (const n of nodes.values()) n.children.sort(byTitle);
  const roots = [...nodes.values()]
    .filter((n) => !n.parent)
    .map((n) => n.key)
    .sort(byTitle);
  const walk = (key: string, depth: number) => {
    const n = nodes.get(key)!;
    n.depth = depth;
    for (const child of n.children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);

  // A title is its own code; a zone that is no title belongs to the deepest position listing it.
  const owners = new Map<string, { node: string; label: string }>();
  for (const n of nodes.values()) owners.set(n.key, { node: n.key, label: n.title });
  const zoneOwner = new Map<string, { node: PositionNode; label: string }>();
  for (const n of nodes.values())
    for (const zone of n.positions.flatMap((p) => p.zones)) {
      const key = titleKey(zone);
      if (!key || nodes.has(key)) continue;
      const was = zoneOwner.get(key);
      if (!was || n.depth > was.node.depth) zoneOwner.set(key, { node: n, label: zone });
    }
  for (const [key, { node: n, label }] of zoneOwner) owners.set(key, { node: n.key, label });
  return { nodes, roots, owners };
}

// The node a TSM code from the visit data belongs to, or null.
export const ownerOf = (h: Hierarchy, code: string) => h.owners.get(titleKey(code))?.node ?? null;

// The node and every node under it.
export function subtree(h: Hierarchy, key: string): string[] {
  const out: string[] = [];
  const stack = [key];
  while (stack.length) {
    const at = stack.pop()!;
    const n = h.nodes.get(at);
    if (!n) continue;
    out.push(at);
    stack.push(...n.children);
  }
  return out;
}

// Every code (as written in the file) under the positions with these titles: what a person linked
// to them may see. Titles that are no node give nothing.
export function codesUnder(h: Hierarchy, titles: string[]): string[] {
  const keys = new Set(titles.flatMap((title) => subtree(h, titleKey(title))));
  return [...h.owners.values()].filter((o) => keys.has(o.node)).map((o) => o.label);
}

// The positions linked to people of `userIds` (null: to anyone) → the codes under them.
export function linkedPositionCodes(
  h: Hierarchy | null,
  links: Record<string, string>,
  userIds: Set<string> | null,
): string[] {
  if (!h) return [];
  const titles = Object.entries(links)
    .filter(([, userId]) => !userIds || userIds.has(userId))
    .map(([title]) => title);
  return codesUnder(h, titles);
}

// --- The managers' tree -------------------------------------------------------------------------

export type TreeNode = {
  key: string;
  title: string;
  people: { name: string | null; roles: string[] }[];
  depth: number;
  // The TSM codes of this position itself (its title, or zones no deeper position lists).
  own: TsmRow[];
  // Summed over its own codes and every one under it; null when there is none.
  totals: RowTotals | null;
  tsms: number;
  children: TreeNode[];
};

// The tree for the managers' level: every position with the numbers of the TSMs under it.
// `rows` are the TSMs the viewer may see; `scope` (null: everyone) also keeps the positions linked
// to them without TSMs in the data. Top positions without any TSM (the distributor's staff) are
// `idle`; TSMs that belong to no position are `outside`.
export function managerTree(h: Hierarchy, rows: TsmRow[], scope: Set<string> | null) {
  const rowsOf = new Map<string, TsmRow[]>();
  const outside: TsmRow[] = [];
  for (const row of rows) {
    const owner = ownerOf(h, row.code);
    if (!owner) outside.push(row);
    else rowsOf.set(owner, [...(rowsOf.get(owner) ?? []), row]);
  }
  const allowed = scope ? new Set([...scope].map(titleKey)) : null;

  const build = (key: string, depth: number): TreeNode | null => {
    const n = h.nodes.get(key)!;
    const children = n.children
      .map((child) => build(child, depth + 1))
      .filter((c): c is TreeNode => c !== null)
      // Positions with TSMs first, then by title.
      .sort((a, b) => Number(b.tsms > 0) - Number(a.tsms > 0) || natural(a.title, b.title));
    const own = (rowsOf.get(key) ?? []).sort((a, b) => natural(a.code, b.code));
    const all = [...own, ...children.flatMap((c) => collect(c))];
    if (allowed && !all.length && !allowed.has(key) && !children.length) return null;
    return {
      key,
      title: n.title,
      people: n.positions.map((p) => ({ name: p.user, roles: p.roles })),
      depth,
      own,
      totals: all.length ? aggregateRows(all) : null,
      tsms: all.length,
      children,
    };
  };
  const tree = h.roots
    .map((root) => build(root, 0))
    .filter((n): n is TreeNode => n !== null)
    .sort((a, b) => b.tsms - a.tsms || natural(a.title, b.title));
  return {
    roots: tree.filter((n) => n.tsms > 0),
    idle: tree.filter((n) => n.tsms === 0),
    outside,
  };
}
export type ManagerTree = ReturnType<typeof managerTree>;

// The TSM rows of a node and every node under it.
function collect(n: TreeNode): TsmRow[] {
  return [...n.own, ...n.children.flatMap(collect)];
}

// The tree as rows, top-down (for the downloads): `depth` gives the indent.
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

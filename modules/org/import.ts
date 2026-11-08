import { z } from "zod";

import { db } from "@/lib/db";
import { matchUser } from "./match";
import { saveOrgNode } from "./service";

export { matchUser };

// Loads a whole org chart at once (e.g. from a picture the owner sent), as nested JSON:
// { "unit": "Marketing Department", "children": [ { "person": "Jo Hogwon", "title": "Director", "children": [...] } ] }
// A position with "person": null is a vacancy. People are linked to app users with the same name.

type ImportNode = {
  unit?: string;
  person?: string | null;
  title?: string;
  label?: string;
  children?: ImportNode[];
};

const nodeSchema: z.ZodType<ImportNode> = z.lazy(() =>
  z.object({
    unit: z.string().trim().min(1).max(120).optional(),
    person: z.string().trim().max(120).nullable().optional(),
    title: z.string().trim().max(120).optional(),
    label: z.string().trim().max(120).optional(),
    children: z.array(nodeSchema).optional(),
  }),
);
export const importSchema = z.array(nodeSchema).min(1);

export async function importOrgChart(input: unknown, options: { replace?: boolean } = {}) {
  const roots = importSchema.parse(input);
  const owner = await db.user.findFirst({
    where: { role: "OWNER", deactivatedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("No owner yet: log in to the site first.");
  if ((await db.orgNode.count()) > 0) {
    if (!options.replace)
      throw new Error("The org chart is not empty. Run with replace to load it again.");
    await db.orgNode.deleteMany();
  }
  const users = await db.user.findMany({
    where: { deactivatedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  const linked = new Set<string>();
  const stats = { units: 0, people: 0, linked: 0, vacancies: 0 };

  const add = async (node: ImportNode, parentId: string | null, sortOrder: number) => {
    let id: string;
    if (node.unit) {
      id = (
        await saveOrgNode(owner, null, {
          kind: "UNIT",
          name: node.unit,
          title: node.title ?? null,
          parentId,
          sortOrder,
        })
      ).id;
      stats.units += 1;
    } else {
      const userId = node.person ? matchUser(node.person, users) : null;
      const useUser = userId && !linked.has(userId) ? userId : null;
      if (useUser) linked.add(useUser);
      id = (
        await saveOrgNode(owner, null, {
          kind: "POSITION",
          title: node.title ?? "—",
          label: node.label ?? null,
          userId: useUser,
          personName: useUser ? null : (node.person ?? null),
          parentId,
          sortOrder,
        })
      ).id;
      if (node.person) stats.people += 1;
      else stats.vacancies += 1;
      if (useUser) stats.linked += 1;
    }
    for (const [i, child] of (node.children ?? []).entries()) await add(child, id, i);
  };
  for (const [i, root] of roots.entries()) await add(root, null, i);
  return stats;
}

import Link from "next/link";

import { OrgNodeForm, OrgTree } from "@/components/org/org-tree";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { displayName } from "@/modules/core/users/display-name";
import { canEditOrg, getOrgTree, type OrgTreeNode } from "@/modules/org/service";

// Flat list of nodes for the "reports to" picker, indented by depth.
function flatten(nodes: OrgTreeNode[], depth = 0): { id: string; name: string }[] {
  return nodes.flatMap((n) => [
    {
      id: n.id,
      name: `${"— ".repeat(depth)}${n.kind === "UNIT" ? n.name : `${n.user?.name ?? n.personName ?? t("team.org.vacancy")}, ${n.title}`}`,
    },
    ...flatten(n.children, depth + 1),
  ]);
}

export default async function StructurePage({ searchParams }: PageProps<"/team/structure">) {
  const user = await requireUser();
  const { error } = await searchParams;
  const [tree, users] = await Promise.all([
    getOrgTree(),
    db.user.findMany({ orderBy: { firstName: "asc" } }),
  ]);
  const editable = canEditOrg(user);
  const options = {
    people: users.map((u) => ({ id: u.id, name: displayName(u) })),
    nodes: flatten(tree),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("team.org.title")}</h1>
        <Link href="/team" className="text-sm underline">
          ← {t("nav.team")}
        </Link>
      </div>
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`team.org.errors.${error}` as TranslationKey)}
        </p>
      )}
      <Card className="overflow-x-auto">
        {tree.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {editable ? t("team.org.emptyOwner") : t("team.org.empty")}
          </p>
        ) : (
          <OrgTree nodes={tree} editable={editable} options={options} />
        )}
      </Card>
      {editable && (
        <details className="rounded-xl border p-4" open={tree.length === 0}>
          <summary className="cursor-pointer font-medium">{t("team.org.addRoot")}</summary>
          <OrgNodeForm parentId={null} options={options} />
        </details>
      )}
    </div>
  );
}

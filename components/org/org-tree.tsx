import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import type { OrgTreeNode } from "@/modules/org/service";

import { deleteOrgNodeAction, saveOrgNodeAction } from "@/app/(app)/team/structure/actions";

type Options = {
  people: { id: string; name: string }[];
  nodes: { id: string; name: string }[];
};

// One form for adding and editing: units have a name and a type, positions a job title and a person.
export function OrgNodeForm({
  node,
  parentId,
  options,
}: {
  node?: OrgTreeNode;
  parentId?: string | null;
  options: Options;
}) {
  return (
    <form
      action={saveOrgNodeAction}
      className="bg-muted/40 mt-2 grid max-w-xl gap-2 rounded-lg p-3 text-sm sm:grid-cols-2"
    >
      {node && <input type="hidden" name="nodeId" value={node.id} />}
      <Label className="flex-col items-start">
        {t("team.org.kind")}
        <NativeSelect name="kind" defaultValue={node?.kind ?? "POSITION"} className="w-full">
          <option value="POSITION">{t("team.org.kinds.POSITION")}</option>
          <option value="UNIT">{t("team.org.kinds.UNIT")}</option>
        </NativeSelect>
      </Label>
      <Label className="flex-col items-start">
        {t("team.org.parent")}
        <NativeSelect
          name="parentId"
          defaultValue={node ? (node.parentId ?? "") : (parentId ?? "")}
          className="w-full"
        >
          <option value="">{t("team.org.parentNone")}</option>
          {options.nodes
            .filter((n) => n.id !== node?.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
        </NativeSelect>
      </Label>
      <Label className="flex-col items-start">
        {t("team.org.jobTitle")} / {t("team.org.unitType")}
        <Input name="title" defaultValue={node?.title ?? ""} maxLength={120} />
      </Label>
      <Label className="flex-col items-start">
        {t("team.org.name")}
        <Input name="name" defaultValue={node?.name ?? ""} maxLength={120} />
      </Label>
      <Label className="flex-col items-start">
        {t("team.org.personApp")}
        <NativeSelect name="userId" defaultValue={node?.user?.id ?? ""} className="w-full">
          <option value="">{t("team.org.personNone")}</option>
          {options.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Label>
      <Label className="flex-col items-start">
        {t("team.org.personName")}
        <Input name="personName" defaultValue={node?.personName ?? ""} maxLength={120} />
      </Label>
      <Label className="flex-col items-start">
        {t("team.org.label")}
        <Input name="label" defaultValue={node?.label ?? ""} maxLength={120} />
      </Label>
      <Label className="flex-col items-start">
        {t("team.org.order")}
        <Input
          type="number"
          name="sortOrder"
          min={0}
          max={999}
          defaultValue={node?.sortOrder ?? 0}
          className="w-24"
        />
      </Label>
      <Button type="submit" size="sm" className="self-end justify-self-start">
        {node ? t("team.org.save") : t("team.org.add")}
      </Button>
    </form>
  );
}

function NodeBody({ node }: { node: OrgTreeNode }) {
  if (node.kind === "UNIT") {
    return (
      <div>
        <p className="font-semibold">{node.name}</p>
        {node.title && <p className="text-muted-foreground text-sm">{node.title}</p>}
      </div>
    );
  }
  const vacant = !node.user && !node.personName;
  return (
    <div>
      {node.label && <p className="text-muted-foreground mb-0.5 text-xs">{node.label}</p>}
      {node.user ? (
        <Link href={`/team/${node.user.id}`} className="font-semibold hover:underline">
          {node.user.name}
        </Link>
      ) : (
        <p className={vacant ? "text-muted-foreground font-semibold italic" : "font-semibold"}>
          {node.personName ?? t("team.org.vacancy")}
          {node.personName && (
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              ({t("team.org.notInApp")})
            </span>
          )}
        </p>
      )}
      <p className="text-muted-foreground text-sm">{node.title}</p>
    </div>
  );
}

// The tree: a vertical line down the left of every group of children, a short tick to each child.
export function OrgTree({
  nodes,
  editable,
  options,
  depth = 0,
}: {
  nodes: OrgTreeNode[];
  editable: boolean;
  options: Options;
  depth?: number;
}) {
  return (
    <ul
      className={
        depth === 0
          ? "flex flex-col gap-4"
          : "border-border ml-2 flex flex-col gap-3 border-l pl-6 sm:ml-4 sm:pl-8"
      }
    >
      {nodes.map((node) => (
        <li key={node.id} className="relative">
          {depth > 0 && (
            <span
              className="bg-border absolute top-3 -left-6 h-px w-4 sm:-left-8 sm:w-6"
              aria-hidden
            />
          )}
          <NodeBody node={node} />
          {editable && (
            <details className="text-sm">
              <summary className="text-muted-foreground w-fit cursor-pointer text-xs hover:underline">
                {t("team.org.edit")}
              </summary>
              <OrgNodeForm node={node} options={options} />
              <form action={deleteOrgNodeAction} className="mt-2 flex items-center gap-2">
                <input type="hidden" name="nodeId" value={node.id} />
                <Button type="submit" size="sm" variant="ghost" className="text-destructive">
                  {t("team.org.delete")}
                </Button>
                <span className="text-muted-foreground text-xs">{t("team.org.deleteHint")}</span>
              </form>
              <p className="text-muted-foreground mt-3 text-xs font-medium">
                {t("team.org.addChild")}
              </p>
              <OrgNodeForm parentId={node.id} options={options} />
            </details>
          )}
          {node.children.length > 0 && (
            <div className="mt-3">
              <OrgTree
                nodes={node.children}
                editable={editable}
                options={options}
                depth={depth + 1}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

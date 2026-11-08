import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import Link from "next/link";

import {
  deleteOrgNodeAction,
  freeOrgPlaceAction,
  invitePlaceAction,
  moveOrgNodeAction,
  revokePlaceInviteAction,
  saveOrgNodeAction,
} from "@/app/(app)/team/structure/actions";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/team/share-button";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import type { OrgTreeNode } from "@/modules/org/service";

import { NodeFields } from "./node-fields";

type Options = {
  people: { id: string; name: string }[];
  nodes: { id: string; name: string }[];
  // Active invites to places, by node, with ready links and the message to send.
  invites?: Map<
    string,
    {
      id: string;
      role: "MANAGER" | "MEMBER" | "OWNER" | "LAWYER";
      link: string;
      message: string;
    }
  >;
  inviteDays?: number;
  // Opened from the chart: this place's form («изменить» or «+») is open.
  editId?: string;
  addId?: string;
};

// How a place is called in questions: the unit's name, or the person (or «Вакансия») and the job.
export function nodeName(node: OrgTreeNode) {
  if (node.kind === "UNIT") return node.name ?? "";
  return `${node.user?.name ?? node.personName ?? t("team.org.vacancy")}, ${node.title ?? ""}`;
}

// For an empty place (someone outside the app or a vacancy): invite a person straight into it.
function PlaceInvite({ node, options }: { node: OrgTreeNode; options: Options }) {
  const invite = options.invites?.get(node.id);
  if (invite) {
    return (
      <div className="bg-muted/40 mt-1 flex max-w-xl flex-col gap-1.5 rounded-lg p-2 text-xs">
        <p className="font-medium">{t("team.org.invited", { role: t(`roles.${invite.role}`) })}</p>
        <p className="text-muted-foreground break-all">{invite.link}</p>
        <div className="flex flex-wrap gap-2">
          <ShareButton text={invite.message} />
          <CopyButton value={invite.link} label={t("team.copyLink")} />
          <form action={revokePlaceInviteAction}>
            <input type="hidden" name="inviteId" value={invite.id} />
            <input type="hidden" name="nodeId" value={node.id} />
            <Button type="submit" size="sm" variant="ghost">
              {t("team.org.inviteRevoke")}
            </Button>
          </form>
        </div>
      </div>
    );
  }
  return (
    <details className="text-sm">
      <summary className="text-primary w-fit cursor-pointer text-xs font-medium hover:underline">
        {t("team.org.invite")}
      </summary>
      <form
        action={invitePlaceAction}
        className="bg-muted/40 mt-1 flex max-w-xl flex-col gap-2 rounded-lg p-2"
      >
        <input type="hidden" name="nodeId" value={node.id} />
        <p className="text-muted-foreground text-xs">
          {t("team.org.inviteHint", { days: options.inviteDays ?? 7 })}
        </p>
        <div className="flex flex-wrap gap-2">
          <NativeSelect name="role" defaultValue="MEMBER" aria-label={t("team.inviteRole")}>
            <option value="MEMBER">{t("roles.MEMBER")}</option>
            <option value="MANAGER">{t("roles.MANAGER")}</option>
            <option value="LAWYER">{t("roles.LAWYER")}</option>
          </NativeSelect>
          <Button type="submit" size="sm">
            {t("team.org.inviteCreate")}
          </Button>
        </div>
      </form>
    </details>
  );
}

// One form for adding and editing: «Человек / Отдел» decides which fields are shown.
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
      <NodeFields
        node={
          node && {
            id: node.id,
            kind: node.kind,
            name: node.name,
            title: node.title,
            label: node.label,
            personName: node.personName,
            userId: node.user?.id ?? null,
            parentId: node.parentId,
          }
        }
        parentId={parentId}
        nodes={options.nodes}
        people={options.people}
      />
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
        <Link
          href={`/team/${node.user.id}`}
          className={
            node.user.deactivated
              ? "text-muted-foreground font-semibold italic hover:underline"
              : "font-semibold hover:underline"
          }
        >
          {node.user.name}
          {node.user.deactivated && (
            <span className="ml-1 text-xs font-normal">({t("team.deactivation.mark")})</span>
          )}
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

// The owner's tools for one place: up / down, change, delete (asks first, says where the people
// under it go), add someone under it.
function NodeTools({
  node,
  parent,
  first,
  last,
  options,
}: {
  node: OrgTreeNode;
  parent?: OrgTreeNode;
  first: boolean;
  last: boolean;
  options: Options;
}) {
  const move = (direction: "left" | "right") => (
    <form action={moveOrgNodeAction}>
      <input type="hidden" name="nodeId" value={node.id} />
      <input type="hidden" name="direction" value={direction} />
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        className="size-7"
        disabled={direction === "left" ? first : last}
        title={t(direction === "left" ? "team.org.moveUp" : "team.org.moveDown")}
        aria-label={t(direction === "left" ? "team.org.moveUp" : "team.org.moveDown")}
      >
        {direction === "left" ? <ArrowUp /> : <ArrowDown />}
      </Button>
    </form>
  );
  const children = node.children.length;
  const deleteHint =
    node.children.length === 0
      ? t("team.org.deleteHintEmpty")
      : parent
        ? t("team.org.deleteHintMove", { count: children, parent: nodeName(parent) })
        : t("team.org.deleteHintTop", { count: children });
  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {move("left")}
        {move("right")}
        <details className="text-sm" open={options.editId === node.id}>
          <summary className="text-muted-foreground w-fit cursor-pointer px-1 text-xs hover:underline">
            {t("team.org.edit")}
          </summary>
          <OrgNodeForm node={node} options={options} />
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <details className="text-sm" open={options.addId === node.id}>
          <summary className="text-primary flex w-fit cursor-pointer items-center gap-1 text-xs font-medium hover:underline">
            <Plus className="size-3.5" aria-hidden />
            {t("team.org.addChild")}
          </summary>
          <OrgNodeForm parentId={node.id} options={options} />
        </details>
        <ConfirmAction
          label={t("team.org.delete")}
          title={t("team.org.deleteTitle", { name: nodeName(node) })}
          hint={deleteHint}
          confirm={t("team.org.deleteConfirm")}
          action={deleteOrgNodeAction}
          hidden={{ nodeId: node.id, parentId: node.parentId ?? "" }}
          floating
        />
        {node.user?.deactivated && (
          <ConfirmAction
            label={t("team.org.freePlace")}
            title={t("team.org.freePlaceTitle")}
            hint={t("team.org.freePlaceHint", { name: node.user.name })}
            confirm={t("team.org.freePlaceConfirm")}
            action={freeOrgPlaceAction}
            hidden={{ nodeId: node.id }}
            tone="default"
            floating
          />
        )}
      </div>
    </div>
  );
}

// The tree: a vertical line down the left of every group of children, a short tick to each child.
export function OrgTree({
  nodes,
  editable,
  options,
  depth = 0,
  parent,
}: {
  nodes: OrgTreeNode[];
  editable: boolean;
  options: Options;
  depth?: number;
  parent?: OrgTreeNode;
}) {
  return (
    <ul
      className={
        depth === 0
          ? "flex flex-col gap-4"
          : "border-border ml-2 flex flex-col gap-3 border-l pl-6 sm:ml-4 sm:pl-8"
      }
    >
      {nodes.map((node, i) => (
        <li key={node.id} id={`node-${node.id}`} className="relative scroll-mt-24">
          {depth > 0 && (
            <span
              className="bg-border absolute top-3 -left-6 h-px w-4 sm:-left-8 sm:w-6"
              aria-hidden
            />
          )}
          <NodeBody node={node} />
          {editable && node.kind === "POSITION" && !node.user && (
            <PlaceInvite node={node} options={options} />
          )}
          {editable && (
            <NodeTools
              node={node}
              parent={parent}
              first={i === 0}
              last={i === nodes.length - 1}
              options={options}
            />
          )}
          {node.children.length > 0 && (
            <div className="mt-3">
              <OrgTree
                nodes={node.children}
                editable={editable}
                options={options}
                depth={depth + 1}
                parent={node}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

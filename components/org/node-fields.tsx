"use client";

import { useState } from "react";

import { useT } from "@/components/locale-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

type Kind = "POSITION" | "UNIT";

// The fields of a place in the chart: a switch «Человек / Отдел», then only what that kind needs
// (a person: job title, who, the caption above; a unit: name and type).
export function NodeFields({
  node,
  parentId,
  nodes,
  people,
}: {
  node?: {
    id: string;
    kind: Kind;
    name: string | null;
    title: string | null;
    label: string | null;
    personName: string | null;
    userId: string | null;
    parentId: string | null;
  };
  parentId?: string | null;
  // «Подчиняется»: every place, indented by depth.
  nodes: { id: string; name: string }[];
  people: { id: string; name: string }[];
}) {
  const t = useT();
  const [kind, setKind] = useState<Kind>(node?.kind ?? "POSITION");
  return (
    <>
      <input type="hidden" name="kind" value={kind} />
      <div className="bg-secondary/70 inline-flex w-fit gap-0.5 rounded-full p-1 text-sm sm:col-span-2">
        {(["POSITION", "UNIT"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={cn(
              "rounded-full px-3.5 py-1",
              kind === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
            )}
          >
            {t(k === "POSITION" ? "team.org.kindPerson" : "team.org.kindUnit")}
          </button>
        ))}
      </div>
      {kind === "UNIT" ? (
        <>
          <Label className="flex-col items-start">
            {t("team.org.name")}
            <Input name="name" defaultValue={node?.name ?? ""} maxLength={120} required />
          </Label>
          <Label className="flex-col items-start">
            {t("team.org.unitType")}
            <Input name="title" defaultValue={node?.title ?? ""} maxLength={120} />
          </Label>
        </>
      ) : (
        <>
          <Label className="flex-col items-start">
            {t("team.org.jobTitle")}
            <Input name="title" defaultValue={node?.title ?? ""} maxLength={120} required />
          </Label>
          <Label className="flex-col items-start">
            {t("team.org.personApp")}
            <NativeSelect name="userId" defaultValue={node?.userId ?? ""} className="w-full">
              <option value="">{t("team.org.personNone")}</option>
              {people.map((p) => (
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
        </>
      )}
      <Label className="flex-col items-start">
        {t("team.org.parent")}
        <NativeSelect
          name="parentId"
          defaultValue={node ? (node.parentId ?? "") : (parentId ?? "")}
          className="w-full"
        >
          <option value="">{t("team.org.parentNone")}</option>
          {nodes
            .filter((n) => n.id !== node?.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
        </NativeSelect>
      </Label>
    </>
  );
}

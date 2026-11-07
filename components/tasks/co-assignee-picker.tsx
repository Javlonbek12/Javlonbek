"use client";

import { useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { useT } from "@/components/locale-provider";

// Whom to add as a co-assignee, with what the route will do: joins right away or a request.
export function CoAssigneePicker({
  people,
  hints,
}: {
  people: { id: string; label: string }[];
  hints: Record<string, string>;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        name="userId"
        value={value}
        required
        onChange={(e) => setValue(e.target.value)}
        aria-label={t("tasks.coAssignees.choose")}
        className="w-full"
      >
        <option value="" disabled>
          {t("tasks.coAssignees.choose")}
        </option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.label}
          </option>
        ))}
      </NativeSelect>
      <span className="text-muted-foreground text-xs">
        {value && hints[value] ? hints[value] : t("tasks.coAssignees.hint")}
      </span>
    </div>
  );
}

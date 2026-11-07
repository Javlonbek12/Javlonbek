"use client";

import { useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { useT } from "@/components/locale-provider";

// The new assignee in the task panel, with what the route will do for them (routing v2: the route
// is worked out again from the task's author).
export function AssigneePicker({
  initial,
  people,
  hints,
  hintInitial = false,
}: {
  initial: string;
  people: { id: string; label: string }[];
  hints: Record<string, string>;
  // Say what happens for the initial choice too (a new route, not a change of one).
  hintInitial?: boolean;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        name="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t("tasks.fields.assignee")}
        className="w-full"
      >
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.label}
          </option>
        ))}
      </NativeSelect>
      <span className="text-muted-foreground text-xs">
        {(value !== initial || hintInitial) && hints[value]
          ? hints[value]
          : t("tasks.panel.reroute")}
      </span>
    </div>
  );
}

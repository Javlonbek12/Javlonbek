"use client";

import { useState } from "react";

import type { ComposeTaskResult } from "@/app/(app)/tasks/actions";

import { ComposeWithAi } from "./compose-with-ai";
import { TaskForm, type TaskFormProps } from "./task-form";

// The new task form with «Оформить с ИИ» above it (when AI is set up): what the AI wrote out
// fills the form, which starts afresh with those values.
export function NewTaskForm({
  compose,
  initial,
  ...props
}: TaskFormProps & { compose?: (text: string) => Promise<ComposeTaskResult> }) {
  const [version, setVersion] = useState(0);
  const [values, setValues] = useState(initial);
  return (
    <div className="flex flex-col gap-4">
      {compose && (
        <ComposeWithAi
          compose={compose}
          onComposed={(composed) => {
            setValues({ ...initial, ...composed });
            setVersion((n) => n + 1);
          }}
        />
      )}
      <TaskForm key={version} {...props} initial={values} />
    </div>
  );
}

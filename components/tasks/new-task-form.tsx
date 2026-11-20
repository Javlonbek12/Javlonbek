"use client";

import { useState } from "react";

import type { ComposeTaskResult } from "@/app/(app)/tasks/actions";
import type { ComposedTask } from "@/modules/tasks/compose";

import { ComposeWithAi } from "./compose-with-ai";
import { ComposedTaskList, type CreateComposed } from "./composed-task-list";
import { TaskForm, type TaskFormProps } from "./task-form";

// The new task form with «Оформить с ИИ» above it (when AI is set up). One task written out fills
// the form, which starts afresh with those values; several tasks from one text take the form's
// place as a list to check and create at once («Создать все»).
export function NewTaskForm({
  compose,
  createMany,
  initial,
  ...props
}: TaskFormProps & {
  compose?: (text: string) => Promise<ComposeTaskResult>;
  createMany?: CreateComposed;
}) {
  const [version, setVersion] = useState(0);
  const [values, setValues] = useState(initial);
  const [many, setMany] = useState<ComposedTask[] | null>(null);
  // Changes only for «Оформить ещё» after creating several tasks: a fresh, empty panel.
  const [panel, setPanel] = useState(0);
  const backToForm = () => {
    setMany(null);
    setValues(initial);
    setVersion((n) => n + 1);
  };
  return (
    <div className="flex flex-col gap-4">
      {compose && (
        <ComposeWithAi
          key={panel}
          compose={compose}
          onComposed={(tasks) => {
            if (tasks.length > 1 && createMany) {
              setMany(tasks);
              return;
            }
            setMany(null);
            setValues({ ...initial, ...tasks[0]!.values });
            setVersion((n) => n + 1);
          }}
        />
      )}
      {many && createMany ? (
        <ComposedTaskList
          key={`many-${version}`}
          tasks={many}
          create={createMany}
          onCancel={backToForm}
          onAgain={() => {
            backToForm();
            setPanel((n) => n + 1);
          }}
          users={props.users}
          projects={props.projects}
          routes={props.routes}
        />
      ) : (
        <TaskForm key={version} {...props} initial={values} />
      )}
    </div>
  );
}

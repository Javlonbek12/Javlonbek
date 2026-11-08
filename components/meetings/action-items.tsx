"use client";

import { useActionState, useState } from "react";

import type { ProposalState, ProposedRow } from "@/app/(app)/meetings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { type TranslationKey } from "@/lib/i18n";
import { useT } from "@/components/locale-provider";

type Person = { id: string; name: string; route: string };

type Props = {
  meetingId: string;
  action: (state: ProposalState, formData: FormData) => Promise<ProposalState>;
};

// Who the row starts with: a matched person, «Я» / «Я (личная)», or nobody yet ("") when the AI
// heard a name it could not match.
export function initialAssignee(task: ProposedRow): string {
  if (task.assigneeId) return task.assigneeId;
  if (task.unresolved) return "";
  return task.personal ? "mine" : "me";
}

// The assignee picker with what will happen to the task for that person (routing v2).
function AssigneeWithRoute({
  name,
  value,
  onChange,
  task,
  people,
  self,
  required,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  task: ProposedRow;
  people: Person[];
  // The route of a team task on oneself.
  self: string;
  required: boolean;
}) {
  const t = useT();
  const route =
    value === "mine"
      ? t("tasks.route.shortPersonal")
      : value === "me"
        ? self
        : people.find((p) => p.id === value)?.route;
  // Names that matched several people: offer those first.
  const candidates = people.filter((p) => task.candidateIds.includes(p.id));
  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        name={name}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t("tasks.fields.assignee")}
        aria-invalid={required && value === ""}
      >
        {task.unresolved && (
          <option value="">
            {task.saidName
              ? t("meetings.actions.pickSaid", { name: task.saidName })
              : t("meetings.actions.pick")}
          </option>
        )}
        {candidates.length > 0 && (
          <optgroup label={t("meetings.actions.similar")}>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        <option value="me">{t("meetings.actions.me")}</option>
        <option value="mine">{t("meetings.actions.mine")}</option>
        {people
          .filter((p) => !task.candidateIds.includes(p.id))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </NativeSelect>
      {route && <span className="text-muted-foreground text-xs">{route}</span>}
    </div>
  );
}

function ProposalForm({
  meetingId,
  tasks,
  people,
  self,
  action,
  pending,
}: {
  meetingId: string;
  tasks: ProposedRow[];
  people: Person[];
  self: string;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const t = useT();
  const [assignees, setAssignees] = useState(() => tasks.map(initialAssignee));
  const [included, setIncluded] = useState(() => tasks.map(() => true));
  const unpicked = tasks.filter((_, i) => included[i] && assignees[i] === "").length;
  const none = included.every((v) => !v);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="meetingId" value={meetingId} />
      <input type="hidden" name="intent" value="create" />
      <input type="hidden" name="count" value={tasks.length} />
      {tasks.map((task, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={`include_${i}`}
              checked={included[i]}
              onChange={(e) =>
                setIncluded((list) => list.map((v, j) => (j === i ? e.target.checked : v)))
              }
              className="size-4"
            />
            {t("meetings.actions.include")}
          </label>
          <Input
            name={`title_${i}`}
            defaultValue={task.title}
            required={included[i]}
            maxLength={200}
            aria-label={t("tasks.fields.title")}
          />
          <div className="grid grid-cols-2 gap-2">
            <AssigneeWithRoute
              name={`assignee_${i}`}
              value={assignees[i]}
              onChange={(value) =>
                setAssignees((list) => list.map((v, j) => (j === i ? value : v)))
              }
              task={task}
              people={people}
              self={self}
              required={included[i]}
            />
            <Input
              type="date"
              name={`due_${i}`}
              defaultValue={task.dueDate ?? ""}
              aria-label={t("tasks.fields.dueDate")}
            />
          </div>
          <input type="hidden" name={`priority_${i}`} value={task.priority ?? ""} />
          <input type="hidden" name={`project_${i}`} value={task.project ?? ""} />
        </div>
      ))}
      {unpicked > 0 && (
        <p className="text-destructive text-sm">
          {t("meetings.actions.pickFirst", { n: unpicked })}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={pending || unpicked > 0 || none}>
        {pending ? "…" : t("meetings.actions.create")}
      </Button>
    </form>
  );
}

// "Find tasks in the minutes": AI proposes rows, the user edits and confirms them. Creating clears
// the proposal and says what happened: created, sent for approval, not created.
export function ActionItems({ meetingId, action }: Props) {
  const t = useT();
  const [state, dispatch, pending] = useActionState(action, {
    error: null,
    tasks: null,
    people: [],
  });
  const result = state.result;

  return (
    <div className="flex flex-col gap-3">
      <form action={dispatch}>
        <input type="hidden" name="meetingId" value={meetingId} />
        <input type="hidden" name="intent" value="propose" />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending && !state.tasks ? "…" : t("meetings.actions.find")}
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(state.error as TranslationKey)}
        </p>
      )}
      {result && (
        <div role="status" className="bg-secondary flex flex-col gap-1 rounded-md p-3 text-sm">
          <span>{t("meetings.actions.created", { count: result.created })}</span>
          {result.pending > 0 && (
            <span>{t("meetings.actions.sentForApproval", { count: result.pending })}</span>
          )}
          {result.errors.map((error, i) => (
            <span key={i} className="text-destructive">
              {error}
            </span>
          ))}
        </div>
      )}
      {state.tasks && state.tasks.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("meetings.actions.none")}</p>
      )}
      {state.tasks && state.tasks.length > 0 && (
        <ProposalForm
          // A new proposal starts with fresh picks.
          key={JSON.stringify(state.tasks)}
          meetingId={meetingId}
          tasks={state.tasks}
          people={state.people}
          self={state.self ?? ""}
          action={dispatch}
          pending={pending}
        />
      )}
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { TaskFormState } from "@/app/(app)/tasks/actions";
import { type TranslationKey } from "@/lib/i18n";
import { useT } from "@/components/locale-provider";
import type { RouteHint } from "@/modules/tasks/route-hints";

type Option = { id: string; label: string; isPersonal?: boolean };

export type TaskFormProps = {
  action: (state: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  // Initial field values (as strings, like form inputs).
  initial: Record<string, string>;
  // Create form: true; edit form: false (kind of task can't change).
  isNew: boolean;
  // Create form: what happens to a team task for each possible assignee (routing v2).
  routes?: Record<string, { plain: RouteHint; flagged: RouteHint }>;
  users: Option[];
  plans: Option[];
  projects: string[];
};

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

// How the task repeats (empty: it doesn't). Values come back as strings, like other fields.
function RepeatFields({ values }: { values: Record<string, string> }) {
  const t = useT();
  const [frequency, setFrequency] = useState(values.repeat ?? "");
  const days = (values.repeatDay ?? "").split(",");
  return (
    <Card className="gap-3">
      <Label className="flex-col items-start">
        {t("tasks.repeat.title")}
        <NativeSelect
          name="repeat"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className="w-full"
        >
          <option value="">{t("tasks.repeat.none")}</option>
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {t(`tasks.repeat.${f}`)}
            </option>
          ))}
        </NativeSelect>
      </Label>
      {frequency && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Label className="flex-col items-start">
              {t("tasks.repeat.every")}
              <div className="flex w-full items-center gap-2">
                <Input
                  type="number"
                  name="repeatInterval"
                  min={1}
                  max={99}
                  defaultValue={values.repeatInterval || "1"}
                  className="w-20"
                />
                <span className="text-muted-foreground text-sm">
                  {t(`tasks.repeat.unit.${frequency as (typeof FREQUENCIES)[number]}`)}
                </span>
              </div>
            </Label>
            <Label className="flex-col items-start">
              {t("tasks.repeat.until")}
              <Input type="date" name="repeatUntil" defaultValue={values.repeatUntil} />
            </Label>
          </div>
          {frequency === "WEEKLY" && (
            <fieldset className="flex flex-col gap-1.5 text-sm">
              <legend className="mb-1.5 font-medium">{t("tasks.repeat.weekdays")}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {WEEKDAYS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="repeatDay"
                      value={d}
                      defaultChecked={days.includes(d)}
                      className="size-4"
                    />
                    {t(`tasks.repeat.days.${d}`)}
                  </label>
                ))}
              </div>
              <span className="text-muted-foreground text-xs">
                {t("tasks.repeat.weekdaysHint")}
              </span>
            </fieldset>
          )}
          {frequency === "MONTHLY" && (
            <Label className="flex-col items-start">
              {t("tasks.repeat.monthDay")}
              <Input
                type="number"
                name="repeatMonthDay"
                min={1}
                max={31}
                defaultValue={values.repeatMonthDay}
                className="w-24"
              />
              <span className="text-muted-foreground text-xs font-normal">
                {t("tasks.repeat.monthDayHint")}
              </span>
            </Label>
          )}
          <p className="text-muted-foreground text-xs">{t("tasks.repeat.hint")}</p>
        </>
      )}
    </Card>
  );
}

export function TaskForm({
  action,
  initial,
  isNew,
  routes,
  users,
  plans,
  projects,
}: TaskFormProps) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, { error: null, values: initial });
  const values = state.values;
  const [isPersonal, setIsPersonal] = useState(values.isPersonal === "on");
  const [assigneeId, setAssigneeId] = useState(values.assigneeId ?? "");
  const [needsApproval, setNeedsApproval] = useState(values.needsApproval === "on");
  const route = routes?.[assigneeId]?.[needsApproval ? "flagged" : "plain"];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {values.taskId && <input type="hidden" name="taskId" value={values.taskId} />}
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`tasks.errors.${state.error}` as TranslationKey, { mb: 20 })}
        </p>
      )}
      <Card className="gap-3">
        <Label className="flex-col items-start">
          {t("tasks.fields.title")}
          <Input name="title" required maxLength={200} defaultValue={values.title} />
        </Label>
        <Label className="flex-col items-start">
          {t("tasks.fields.description")}
          <Textarea name="description" maxLength={5000} defaultValue={values.description} />
        </Label>
        {isNew && (
          <Label>
            <input
              type="checkbox"
              name="isPersonal"
              className="size-4"
              checked={isPersonal}
              onChange={(e) => setIsPersonal(e.target.checked)}
            />
            {t("tasks.fields.personal")}
          </Label>
        )}
        {!isPersonal && (
          <Label className="flex-col items-start">
            {t("tasks.fields.assignee")}
            <NativeSelect
              name="assigneeId"
              required
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full"
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.label}
                </option>
              ))}
            </NativeSelect>
          </Label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Label className="flex-col items-start">
            {t("tasks.fields.startDate")}
            <Input type="date" name="startDate" defaultValue={values.startDate} />
          </Label>
          <Label className="flex-col items-start">
            {t("tasks.fields.dueDate")}
            <Input type="date" name="dueDate" defaultValue={values.dueDate} />
          </Label>
          <Label className="flex-col items-start">
            {t("tasks.fields.priority")}
            <NativeSelect
              name="priority"
              defaultValue={values.priority || "MEDIUM"}
              className="w-full"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`tasks.priority.${p}`)}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("tasks.fields.estimate")}
            <Input
              type="number"
              name="estimateHours"
              min={0}
              step={0.5}
              inputMode="decimal"
              defaultValue={values.estimateHours}
            />
          </Label>
        </div>
        <Label className="flex-col items-start">
          {t("tasks.fields.project")}
          <Input name="project" list="projects" maxLength={60} defaultValue={values.project} />
          <datalist id="projects">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Label>
        <Label className="flex-col items-start">
          {t("tasks.fields.plan")}
          <NativeSelect name="planId" defaultValue={values.planId} className="w-full">
            <option value="">{t("tasks.fields.noPlan")}</option>
            {plans
              .filter((plan) => plan.isPersonal === isPersonal)
              .map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.label}
                </option>
              ))}
          </NativeSelect>
        </Label>
      </Card>
      <RepeatFields values={values} />

      <div className="flex flex-wrap gap-2">
        {!isNew ? (
          <Button type="submit" disabled={pending}>
            {t("tasks.save")}
          </Button>
        ) : isPersonal ? (
          <>
            <Button type="submit" name="mode" value="start" disabled={pending}>
              {t("tasks.create.start")}
            </Button>
            <Button type="submit" name="mode" value="draft" variant="outline" disabled={pending}>
              {t("tasks.create.draft")}
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="mode" value="create" disabled={pending}>
              {t("tasks.create.create")}
            </Button>
            <Button type="submit" name="mode" value="draft" variant="outline" disabled={pending}>
              {t("tasks.create.draft")}
            </Button>
          </>
        )}
      </div>
      {isNew && !isPersonal && (
        <div className="flex flex-col gap-2 text-sm">
          {route && (
            <p
              className={
                route.status === "APPROVED"
                  ? "text-muted-foreground"
                  : "rounded-md bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300"
              }
            >
              {route.text}
            </p>
          )}
          <Label className="font-normal">
            <input
              type="checkbox"
              name="needsApproval"
              className="size-4"
              checked={needsApproval}
              onChange={(e) => setNeedsApproval(e.target.checked)}
            />
            {t("tasks.route.needsApproval")}
          </Label>
          <span className="text-muted-foreground text-xs">
            {t("tasks.route.needsApprovalHint")}
          </span>
        </div>
      )}
    </form>
  );
}

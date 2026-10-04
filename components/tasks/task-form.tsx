"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { TaskFormState } from "@/app/(app)/tasks/actions";
import { t, type TranslationKey } from "@/lib/i18n";

type Option = { id: string; label: string; isPersonal?: boolean };

export type TaskFormProps = {
  action: (state: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  // Initial field values (as strings, like form inputs).
  initial: Record<string, string>;
  // Create form: true; edit form: false (kind of task can't change).
  isNew: boolean;
  canApprove: boolean;
  users: Option[];
  plans: Option[];
  projects: string[];
};

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export function TaskForm({
  action,
  initial,
  isNew,
  canApprove,
  users,
  plans,
  projects,
}: TaskFormProps) {
  const [state, formAction, pending] = useActionState(action, { error: null, values: initial });
  const values = state.values;
  const [isPersonal, setIsPersonal] = useState(values.isPersonal === "on");

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
              defaultValue={values.assigneeId}
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
            {canApprove && (
              <Button type="submit" name="mode" value="approve" disabled={pending}>
                {t("tasks.create.approve")}
              </Button>
            )}
            <Button
              type="submit"
              name="mode"
              value="submit"
              variant={canApprove ? "outline" : "default"}
              disabled={pending}
            >
              {t("tasks.create.submit")}
            </Button>
            <Button type="submit" name="mode" value="draft" variant="outline" disabled={pending}>
              {t("tasks.create.draft")}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

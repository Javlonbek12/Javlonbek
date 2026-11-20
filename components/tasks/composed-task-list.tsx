"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useState, useTransition } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { CreateComposedResult } from "@/app/(app)/tasks/actions";
import type { ComposedTask } from "@/modules/tasks/compose";
import { parseDraftSteps, type DraftStep } from "@/modules/tasks/draft-steps";
import type { ProjectOption } from "@/modules/tasks/form-options";
import type { RouteHint } from "@/modules/tasks/route-hints";

import { DraftSteps } from "./task-form";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
type Priority = (typeof PRIORITIES)[number];

type Item = {
  key: number;
  title: string;
  assigneeId: string;
  personal: boolean;
  dueDate: string;
  priority: Priority;
  project: string;
  description: string;
  steps: DraftStep[];
  // What the AI says is missing and what it could not fill (shown, never saved).
  hints: string[];
};

export type CreateComposed = (tasks: unknown) => Promise<CreateComposedResult>;

const toItem = (task: ComposedTask, key: number): Item => ({
  key,
  title: task.values.title ?? "",
  assigneeId: task.values.assigneeId ?? "",
  personal: task.values.isPersonal === "on",
  dueDate: task.values.dueDate ?? "",
  priority: (PRIORITIES as readonly string[]).includes(task.values.priority ?? "")
    ? (task.values.priority as Priority)
    : "MEDIUM",
  project: task.values.project ?? "",
  description: task.values.description ?? "",
  steps: parseDraftSteps(task.values.steps),
  hints: [...task.notes, ...task.missing],
});

// Several tasks «Оформить с ИИ» found in one text: each can be fixed or taken out, then all are
// created at once («Создать все»), each along its route with its steps.
export function ComposedTaskList({
  tasks,
  create,
  onCancel,
  onAgain,
  users,
  projects,
  routes,
}: {
  tasks: ComposedTask[];
  create: CreateComposed;
  // «Отмена»: back to the one-task form (the text stays in the panel to rephrase).
  onCancel: () => void;
  // «Оформить ещё» after creating: the form and an empty panel.
  onAgain: () => void;
  users: { id: string; label: string }[];
  projects: ProjectOption[];
  routes?: Record<string, { plain: RouteHint; flagged: RouteHint }>;
}) {
  const t = useT();
  const [items, setItems] = useState(() => tasks.map(toItem));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<CreateComposedResult, { ok: true }> | null>(null);
  const [pending, startTransition] = useTransition();

  const change = (key: number, patch: Partial<Item>) =>
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  function createAll() {
    const missing = items.findIndex((item) => !item.title.trim());
    if (missing >= 0) return setError(t("tasks.composeMany.needTitle", { n: missing + 1 }));
    const noOne = items.findIndex((item) => !item.personal && !item.assigneeId);
    if (noOne >= 0) return setError(t("tasks.composeMany.needAssignee", { n: noOne + 1 }));
    setError(null);
    startTransition(async () => {
      const result = await create(
        items.map((item) => ({
          title: item.title,
          assigneeId: item.personal ? null : item.assigneeId,
          personal: item.personal,
          dueDate: item.dueDate || null,
          priority: item.priority,
          project: item.project || null,
          description: item.description || null,
          steps: item.steps,
        })),
      );
      if (result.ok) setDone(result);
      else setError(t(result.error));
    });
  }

  if (done) {
    return (
      <Card role="status" className="gap-3">
        <p className="font-medium">{t("tasks.composeMany.created", { count: done.saved })}</p>
        {done.pending > 0 && (
          <p className="text-sm">{t("tasks.composeMany.pending", { count: done.pending })}</p>
        )}
        {done.errors.map((line, i) => (
          <p key={i} className="text-destructive text-sm">
            {line}
          </p>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/tasks">{t("tasks.composeMany.toTasks")}</Link>
          </Button>
          <Button type="button" variant="outline" onClick={onAgain}>
            {t("tasks.composeMany.again")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item, i) => {
        const route = !item.personal && item.assigneeId ? routes?.[item.assigneeId]?.plain : null;
        return (
          <Card
            key={item.key}
            role="group"
            className="gap-3"
            aria-label={t("tasks.composeMany.item", { n: i + 1 })}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-sm font-medium">
                {t("tasks.composeMany.item", { n: i + 1 })}
              </span>
              {items.length > 1 && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={t("tasks.composeMany.remove", { n: i + 1 })}
                  onClick={() => setItems((list) => list.filter((x) => x.key !== item.key))}
                >
                  <X />
                </Button>
              )}
            </div>
            <Label className="flex-col items-start">
              {t("tasks.fields.title")}
              <Input
                value={item.title}
                maxLength={200}
                onChange={(e) => change(item.key, { title: e.target.value })}
              />
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label className="flex-col items-start">
                  {t("tasks.fields.assignee")}
                  <NativeSelect
                    value={item.assigneeId}
                    disabled={item.personal}
                    onChange={(e) => change(item.key, { assigneeId: e.target.value })}
                    className="w-full"
                  >
                    <option value="">{t("tasks.composeMany.chooseAssignee")}</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>
                <Label className="font-normal">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={item.personal}
                    onChange={(e) => change(item.key, { personal: e.target.checked })}
                  />
                  {t("tasks.composeMany.personal")}
                </Label>
                {route && <span className="text-muted-foreground text-xs">{route.text}</span>}
              </div>
              <Label className="flex-col items-start">
                {t("tasks.fields.dueDate")}
                <Input
                  type="date"
                  value={item.dueDate}
                  onChange={(e) => change(item.key, { dueDate: e.target.value })}
                />
              </Label>
              <Label className="flex-col items-start">
                {t("tasks.fields.priority")}
                <NativeSelect
                  value={item.priority}
                  onChange={(e) => change(item.key, { priority: e.target.value as Priority })}
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
                {t("tasks.fields.project")}
                <NativeSelect
                  value={item.project}
                  onChange={(e) => change(item.key, { project: e.target.value })}
                  className="w-full"
                >
                  <option value="">{t("tasks.form.noProject")}</option>
                  {projects.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Label>
            </div>
            <Label className="flex-col items-start">
              {t("tasks.fields.description")}
              <Textarea
                value={item.description}
                maxLength={5000}
                rows={item.description ? 4 : 2}
                onChange={(e) => change(item.key, { description: e.target.value })}
              />
            </Label>
            {item.steps.length > 0 && (
              <DraftSteps steps={item.steps} onChange={(steps) => change(item.key, { steps })} />
            )}
            {item.hints.length > 0 && (
              <div className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                <p className="font-medium">{t("tasks.compose.missing")}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {item.hints.map((line, j) => (
                    <li key={j}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        );
      })}
      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={createAll} disabled={pending || items.length === 0}>
          {pending
            ? t("tasks.composeMany.creating")
            : t("tasks.composeMany.createAll", { count: items.length })}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t("tasks.composeMany.cancel")}
        </Button>
      </div>
    </div>
  );
}

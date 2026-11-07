import { Check, ChevronDown, ChevronUp, Trash2 } from "lucide-react";

import {
  addStepAction,
  moveStepAction,
  quickCloseAction,
  removeStepAction,
  tickStepAction,
  updateStepAction,
} from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay, toDateString } from "@/lib/dates";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { displayName } from "@/modules/core/users/display-name";
import { MAX_STEP_TITLE, currentStep, stepProgress } from "@/modules/tasks/step-rules";
import type { listSteps } from "@/modules/tasks/steps";

type Step = Awaited<ReturnType<typeof listSteps>>[number];

// The «Работа» tab of a task: the steps with who and by when, the progress, where the work
// stopped, and — when every step is done — the button to hand the task in.
export function StepsTab({
  taskId,
  status,
  steps,
  back,
  today,
  plan,
  tick,
  mine,
  people,
  finish,
}: {
  taskId: string;
  status: TaskStatus;
  steps: Step[];
  // Where the forms come back to (the task on this tab).
  back: string;
  today: string;
  // May add and change steps / tick them.
  plan: boolean;
  tick: boolean;
  // The viewer does the task («Вы остановились здесь»).
  mine: boolean;
  // Who a step can be given to.
  people: { id: string; name: string }[];
  // The next step of the task when every step is done (hand in, or mark done).
  finish: { label: string } | null;
}) {
  const { done, total } = stepProgress(steps);
  const current = currentStep(steps);
  const hidden = (stepId?: string) => (
    <>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="back" value={back} />
      {stepId && <input type="hidden" name="stepId" value={stepId} />}
    </>
  );
  const fields = (step?: Step) => (
    <>
      <Input
        name="title"
        required
        maxLength={MAX_STEP_TITLE}
        defaultValue={step?.title}
        placeholder={t("tasks.steps.placeholder")}
        aria-label={t("tasks.steps.placeholder")}
        className="min-w-0 flex-1 basis-56"
      />
      <NativeSelect
        name="responsibleId"
        defaultValue={step?.responsibleId ?? ""}
        aria-label={t("tasks.steps.responsible")}
        className="w-auto"
      >
        <option value="">{t("tasks.steps.nobody")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
      <Input
        type="date"
        name="dueDate"
        defaultValue={step?.dueDate ? toDateString(step.dueDate) : ""}
        aria-label={t("tasks.steps.due")}
        className="w-auto"
      />
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {total > 0 && (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label={t("tasks.steps.progressLabel", { done, total })}
            className="bg-muted h-2 flex-1 overflow-hidden rounded-full"
          >
            <div
              className={cn(
                "h-full rounded-full",
                done === total ? "bg-emerald-500" : "bg-primary",
              )}
              style={{ width: `${Math.round((done / total) * 100)}%` }}
            />
          </div>
          <span className="text-muted-foreground text-sm tabular-nums">
            {t("tasks.steps.progress", { done, total })}
          </span>
        </div>
      )}

      {total > 0 && done === total && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          <span className="font-medium">
            {finish ? t("tasks.steps.allDoneNext") : t("tasks.steps.allDone")}
          </span>
          {finish && (
            <form action={quickCloseAction}>
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="back" value={back} />
              <Button type="submit" size="sm">
                {finish.label}
              </Button>
            </form>
          )}
        </div>
      )}

      {!tick && plan && ["DRAFT", "PENDING_APPROVAL"].includes(status) && (
        <p className="text-muted-foreground text-sm">{t("tasks.steps.waitApproval")}</p>
      )}
      {status === "IN_REVIEW" && total > 0 && (
        <p className="text-muted-foreground text-sm">{t("tasks.steps.inReview")}</p>
      )}
      {tick && mine && status === "APPROVED" && total > 0 && done === 0 && (
        <p className="text-muted-foreground text-sm">{t("tasks.steps.startHint")}</p>
      )}

      {total === 0 ? (
        <p className="text-muted-foreground text-sm">{t("tasks.steps.empty")}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {steps.map((step, index) => {
            const isDone = step.doneAt !== null;
            const here = current?.id === step.id && done > 0;
            const due = step.dueDate ? toDateString(step.dueDate) : null;
            const late = !isDone && due !== null && due < today;
            return (
              <li
                key={step.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg px-2 py-2",
                  here && "bg-primary/5 ring-primary/30 ring-1",
                )}
              >
                {tick ? (
                  <form action={tickStepAction} className="flex shrink-0">
                    {hidden(step.id)}
                    <input type="hidden" name="done" value={isDone ? "0" : "1"} />
                    <button
                      type="submit"
                      aria-label={t(isDone ? "tasks.steps.untick" : "tasks.steps.tick", {
                        title: step.title,
                      })}
                      title={t(isDone ? "tasks.steps.untick" : "tasks.steps.tick", {
                        title: step.title,
                      })}
                      className={cn(
                        "focus-visible:ring-ring mt-0.5 flex size-5 items-center justify-center rounded-md border-2 transition-colors focus-visible:ring-2 focus-visible:outline-none",
                        isDone
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-muted-foreground/50 hover:border-primary",
                      )}
                    >
                      {isDone && <Check className="size-3.5" strokeWidth={3} />}
                    </button>
                  </form>
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2",
                      isDone
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-muted-foreground/25",
                    )}
                  >
                    {isDone && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-sm break-words",
                      isDone && "text-muted-foreground line-through",
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                    {step.responsible && <span>{displayName(step.responsible)}</span>}
                    {due && (
                      <span className={cn(late && "text-destructive font-medium")}>
                        {t("tasks.steps.dueOn", { date: formatDay(due) })}
                      </span>
                    )}
                    {isDone && step.doneBy && (
                      <span>
                        <Check className="inline size-3" aria-hidden />{" "}
                        {t("tasks.steps.doneBy", {
                          name: displayName(step.doneBy),
                          date: formatDay(toDateString(step.doneAt!)),
                        })}
                      </span>
                    )}
                  </span>
                  {here && (
                    <span className="text-primary text-xs font-medium">
                      {mine ? t("tasks.steps.here") : t("tasks.steps.hereOther")}
                    </span>
                  )}
                  {plan && (
                    <details className="mt-1">
                      <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs">
                        {t("tasks.steps.edit")}
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                        <form action={updateStepAction} className="flex flex-wrap gap-2">
                          {hidden(step.id)}
                          {fields(step)}
                          <Button type="submit" size="sm">
                            {t("tasks.steps.save")}
                          </Button>
                        </form>
                        <div className="flex flex-wrap gap-1">
                          {index > 0 && (
                            <form action={moveStepAction}>
                              {hidden(step.id)}
                              <input type="hidden" name="direction" value="up" />
                              <Button type="submit" size="sm" variant="ghost">
                                <ChevronUp />
                                {t("tasks.steps.up")}
                              </Button>
                            </form>
                          )}
                          {index < steps.length - 1 && (
                            <form action={moveStepAction}>
                              {hidden(step.id)}
                              <input type="hidden" name="direction" value="down" />
                              <Button type="submit" size="sm" variant="ghost">
                                <ChevronDown />
                                {t("tasks.steps.down")}
                              </Button>
                            </form>
                          )}
                          <form action={removeStepAction}>
                            {hidden(step.id)}
                            <Button
                              type="submit"
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                            >
                              <Trash2 />
                              {t("tasks.steps.remove")}
                            </Button>
                          </form>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {plan && (
        <form action={addStepAction} className="flex flex-wrap gap-2 border-t pt-3">
          {hidden()}
          {fields()}
          <Button type="submit" size="sm" variant="outline">
            {t("tasks.steps.add")}
          </Button>
        </form>
      )}
    </div>
  );
}

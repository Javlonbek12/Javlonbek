import { ArrowLeft, ClipboardCheck } from "lucide-react";
import Link from "next/link";

import { decideCoAssigneeAction } from "@/app/(app)/tasks/actions";
import { QuickCircle } from "@/components/tasks/quick-circle";
import { QuickUndo } from "@/components/tasks/quick-undo";
import { TaskPanel } from "@/components/tasks/task-panel";
import { TaskTableRow } from "@/components/tasks/task-table-row";
import { Button } from "@/components/ui/button";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { isDoer } from "@/modules/tasks/access";
import { withParams } from "@/modules/tasks/back";
import { quickTarget } from "@/modules/tasks/quick";
import { decisionCount, listDecisions, type TaskView } from "@/modules/tasks/service";

const BASE = "/tasks/decide";
const GROUPS = ["approve", "accept", "dueChange", "remove"] as const;

// «Ждут решения»: everything the route gave the user to decide, in one list — tasks to approve or
// decline, work to accept or send back, requests to delete. A task opens in the panel next to the
// list, with its main button («Утвердить», «Принять») at the bottom. Requests to add a
// co-assignee are decided right in the list.
export default async function TaskDecisionsPage({ searchParams }: PageProps<"/tasks/decide">) {
  const user = await requireUser();
  const params = await searchParams;
  const [today, decisions] = await Promise.all([getUserToday(user.id), listDecisions(user)]);
  const openId = typeof params.task === "string" ? params.task : null;
  const here = openId ? withParams(BASE, { task: openId }) : BASE;
  const total = decisionCount(decisions);
  const rowProps = (task: TaskView) => {
    const target = quickTarget(user, task);
    return {
      href: withParams(BASE, { task: task.id }),
      selected: task.id === openId,
      circle: (
        <QuickCircle
          taskId={task.id}
          status={task.status}
          target={target}
          accepts={target === "DONE" && !task.isPersonal && !isDoer(user, task)}
          blocked={target === "DONE" && task.openBlockers > 0}
          back={here}
          openHref={withParams(BASE, { task: task.id })}
        />
      ),
    };
  };

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ClipboardCheck className="text-primary size-5" />
              {t("tasks.decide.title")}
              <span className="text-muted-foreground font-normal">· {total}</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl text-sm">{t("tasks.decide.hint")}</p>
          </div>
          <Link
            href="/tasks"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="size-4" />
            {t("tasks.decide.back")}
          </Link>
        </div>
        <QuickUndo
          user={user}
          taskId={typeof params.done === "string" ? params.done : null}
          back={here}
        />
        {total === 0 && (
          <p className="text-muted-foreground bg-card rounded-2xl border p-6 text-center text-sm">
            {t("tasks.decide.empty")}
          </p>
        )}
        {GROUPS.filter((group) => decisions[group].length > 0).map((group) => (
          <section key={group} className="flex flex-col gap-2.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-amber-500" />
              {t(`tasks.decide.groups.${group}` as TranslationKey)}
              <span className="text-muted-foreground font-normal">· {decisions[group].length}</span>
            </h3>
            <ul className="flex flex-col gap-2">
              {decisions[group].map((task) => (
                <TaskTableRow key={task.id} task={task} today={today} {...rowProps(task)} />
              ))}
            </ul>
          </section>
        ))}
        {decisions.coAssignees.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-amber-500" />
              {t("tasks.decide.groups.coAssignees")}
              <span className="text-muted-foreground font-normal">
                · {decisions.coAssignees.length}
              </span>
            </h3>
            <ul className="flex flex-col gap-2">
              {decisions.coAssignees.map((request) => (
                <li
                  key={request.id}
                  className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">
                      {t("tasks.decide.coRequest", {
                        requester: request.requestedBy,
                        name: request.name,
                      })}
                    </span>
                    {request.task.visible ? (
                      <Link
                        href={withParams(BASE, { task: request.task.id })}
                        className="text-muted-foreground truncate underline"
                      >
                        {request.task.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground truncate">{request.task.title}</span>
                    )}
                  </span>
                  <form action={decideCoAssigneeAction} className="flex gap-2">
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="back" value={here} />
                    <Button type="submit" size="sm" name="decision" value="approve">
                      {t("tasks.coAssignees.approve")}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      name="decision"
                      value="decline"
                    >
                      {t("tasks.coAssignees.decline")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {openId && (
        <TaskPanel user={user} taskId={openId} base={here} closeHref={BASE} params={params} />
      )}
    </>
  );
}

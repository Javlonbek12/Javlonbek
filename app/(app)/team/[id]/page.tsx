import { MessageCircle, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Avatar } from "@/components/team/avatar";
import { LoadChart } from "@/components/team/load-chart";
import { ProfileRadar } from "@/components/team/profile-radar";
import { onTimeText, personTasksHref } from "@/components/team/stat-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay, toDateString } from "@/lib/dates";
import { EmployeeNoteKind } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { canUseModule } from "@/modules/core/access/actor";
import { deniedHref } from "@/modules/core/access/guard";
import { requireUser } from "@/modules/core/auth/current-user";
import { canChangeRole, canSendTestNotification } from "@/modules/core/permissions";
import { testResultText } from "@/modules/core/notifications/test-result";
import { getSettings } from "@/modules/core/settings/service";
import { displayName, personName } from "@/modules/core/users/display-name";
import { orgPathOf } from "@/modules/org/service";
import { listAssignableUsers } from "@/modules/tasks/service";
import { canDeactivate } from "@/modules/team/deactivation";
import { teamProfiles } from "@/modules/team/profile";
import { countOpenTasks, getEmployeeCard, listManagerCandidates } from "@/modules/team/service";
import { PERCENT_FROM_TASKS } from "@/modules/team/stats";

import { changeRoleAction, sendTestNotificationAction } from "../../actions";
import {
  addNoteAction,
  deactivateUserAction,
  deleteNoteAction,
  reactivateUserAction,
  updateProfileAction,
} from "../actions";

const TABS = ["overview", "profile", "notes", "manage"] as const;
type Tab = (typeof TABS)[number];

function Stat({
  label,
  value,
  alert,
  href,
}: {
  label: string;
  value: string;
  alert?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("text-xl font-semibold", alert && "text-destructive")}>{value}</span>
    </>
  );
  const box = "bg-muted/50 flex flex-col gap-0.5 rounded-lg p-3";
  // A number with a list behind it opens that list (the person's tasks).
  return href ? (
    <Link href={href} className={cn(box, "hover:bg-muted transition-colors")}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function Notice({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return alert ? (
    <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
      {children}
    </p>
  ) : (
    <p role="status" className="bg-secondary rounded-md p-3 text-sm">
      {children}
    </p>
  );
}

export default async function EmployeePage({ params, searchParams }: PageProps<"/team/[id]">) {
  const viewer = await requireUser();
  const { id } = await params;
  // Everyone opens their own card (to keep their contacts up to date); others' cards need the
  // Team or the Org chart section.
  const seesTeam = canUseModule(viewer, "team");
  const seesChart = canUseModule(viewer, "structure");
  if (id !== viewer.id && !seesTeam && !seesChart) redirect(deniedHref("team"));
  const query = await searchParams;
  const card = await getEmployeeCard(viewer, id);
  if (!card) notFound();
  const { user, manager, reports, stats, notes, editable, inChart } = card;
  const fromChart = (
    <span className="text-muted-foreground text-xs font-normal">
      {seesChart ? (
        <Link href="/team/structure" className="underline">
          {t("team.profile.fromChart")}
        </Link>
      ) : (
        t("team.profile.fromChart")
      )}
    </span>
  );
  const deactivatable = canDeactivate(viewer, user);
  const off = user.deactivatedAt !== null;
  const [{ timezone }, managers, orgPath, heirs, openTasks] = await Promise.all([
    getSettings(viewer.id),
    // The current manager stays in the list even if deactivated, so saving keeps them.
    listManagerCandidates(user.managerId),
    orgPathOf(user.id),
    deactivatable && !off ? listAssignableUsers() : Promise.resolve([]),
    deactivatable && !off ? countOpenTasks(user.id) : Promise.resolve(0),
  ]);
  // The radar is shown to the same people who may see the statistics.
  const profiles = stats ? await teamProfiles(timezone) : null;
  const can = (field: (typeof editable)[number]) => editable.includes(field);
  const assignable = (["MANAGER", "MEMBER", "LAWYER"] as const).filter((role) =>
    canChangeRole(viewer, user, role),
  );
  const canTest = canSendTestNotification(viewer, user.id) && !off;
  const back = `/team/${user.id}`;
  const hidden = <input type="hidden" name="employeeId" value={user.id} />;
  const pct = (value: number | null) => (value === null ? t("team.stats.noData") : `${value}%`);
  // The bot matters to the person and to whoever manages them.
  const seesBot = viewer.id === user.id || viewer.role === "OWNER" || viewer.role === "MANAGER";
  // By default the open tasks go to the person's manager, so nothing is left hanging.
  const heirOptions = heirs.filter((h) => h.id !== user.id);
  const defaultHeir = heirOptions.some((h) => h.id === user.managerId) ? user.managerId! : "";

  const tabs = TABS.filter(
    (tab) =>
      (tab === "overview" && stats) ||
      tab === "profile" ||
      (tab === "notes" && notes) ||
      (tab === "manage" && (assignable.length > 0 || canTest || deactivatable)),
  );
  const tab: Tab = tabs.find((x) => x === query.tab) ?? tabs[0]!;
  const tabHref = (x: Tab) => `/team/${user.id}${x === tabs[0] ? "" : `?tab=${x}`}`;
  const errorText =
    query.error === "manager"
      ? t("team.profile.errorManager")
      : query.error === "invalid"
        ? t("team.profile.errorInvalid")
        : ["self", "lastOwner", "handOver", "state"].includes(String(query.error))
          ? t(`team.deactivation.errors.${query.error as "self"}`)
          : t("errors.forbidden");

  return (
    <div className="flex flex-col gap-4">
      {seesTeam && (
        <Link href="/team" className="text-muted-foreground w-fit text-sm hover:underline">
          ← {t("team.title")}
        </Link>
      )}
      {query.saved && <Notice>{t("team.profile.saved")}</Notice>}
      {query.notice === "testSent" && <Notice>{testResultText(query.tg)}</Notice>}
      {query.roleChanged && (
        <Notice>{t("team.roleChanged", { role: t(`roles.${user.role}`) })}</Notice>
      )}
      {query.deactivated && (
        <Notice>
          {t("team.deactivation.done", { moved: Number(query.moved) || 0 })}
          {Number(query.notMoved) > 0 &&
            ` ${t("team.deactivation.notMoved", { count: Number(query.notMoved) })}`}
        </Notice>
      )}
      {query.reactivated && <Notice>{t("team.deactivation.reactivated")}</Notice>}
      {typeof query.error === "string" && <Notice alert>{errorText}</Notice>}

      <header className="flex items-start gap-3">
        <Avatar name={displayName(user)} muted={off} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-medium md:text-2xl">{displayName(user)}</h1>
            <Badge variant={user.role === "OWNER" ? "default" : "secondary"}>
              {t(`roles.${user.role}`)}
            </Badge>
            {off && <Badge variant="outline">{t("team.deactivation.badge")}</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            {user.position ?? t("team.noPosition")}
            {orgPath && orgPath.length > 0 && ` · ${orgPath.at(-1)}`}
            {manager && (
              <>
                {` · ${t("team.profile.manager").toLowerCase()}: `}
                <Link href={`/team/${manager.id}`} className="underline">
                  {personName(manager)}
                </Link>
              </>
            )}
          </p>
          <p className="text-muted-foreground text-xs">
            {user.telegramUsername && `@${user.telegramUsername}`}
            {user.telegramUsername && seesBot && " · "}
            {seesBot &&
              (user.botChatId ? (
                t("team.botLinked")
              ) : (
                <span className="text-foreground font-medium">{t("team.botNotLinked")}</span>
              ))}
          </p>
          {!off && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm" variant="outline">
                <Link href={`/tasks/new?assignee=${encodeURIComponent(user.id)}`}>
                  <Plus />
                  {t("team.actions.task")}
                </Link>
              </Button>
              {user.telegramUsername && (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`https://t.me/${user.telegramUsername}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle />
                    {t("team.actions.write")}
                  </a>
                </Button>
              )}
              {user.phone && (
                <Button asChild size="sm" variant="outline">
                  <a href={`tel:${user.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone />
                    {t("team.actions.call")}
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      </header>
      {user.deactivatedAt && (
        <p className="bg-muted rounded-md p-3 text-sm">
          {t("team.deactivation.off", { date: formatDay(toDateString(user.deactivatedAt)) })}
        </p>
      )}

      {tabs.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b text-sm" aria-label={t("team.title")}>
          {tabs.map((x) => (
            <Link
              key={x}
              href={tabHref(x)}
              aria-current={x === tab ? "page" : undefined}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2",
                x === tab
                  ? "border-primary font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {t(`team.tabs.${x}`)}
            </Link>
          ))}
        </nav>
      )}

      {tab === "overview" && stats && (
        <>
          <Card className="gap-3">
            <CardTitle>{t("team.stats.title")}</CardTitle>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Stat
                label={t("team.stats.active")}
                value={String(stats.active)}
                href={personTasksHref(user.id)}
              />
              <Stat
                label={t("team.stats.overdue")}
                value={String(stats.overdue)}
                alert={stats.overdue > 0}
                href={stats.overdue > 0 ? personTasksHref(user.id, true) : undefined}
              />
              <Stat
                label={t("team.stats.onTime30")}
                value={onTimeText(stats.onTime30) ?? pct(null)}
              />
              <Stat
                label={t("team.stats.onTime90")}
                value={onTimeText(stats.onTime90) ?? pct(null)}
              />
              <Stat
                label={t("team.stats.averageDays")}
                value={
                  stats.averageDays === null
                    ? t("team.stats.noData")
                    : t("team.stats.days", { value: stats.averageDays })
                }
              />
            </div>
            {stats.onTime90.total >= PERCENT_FROM_TASKS && (
              <p className="text-muted-foreground text-xs">
                {t("team.stats.onTime90")}:{" "}
                {t("team.stats.ofTotal", {
                  onTime: stats.onTime90.onTime,
                  total: stats.onTime90.total,
                })}
              </p>
            )}
            <div className="pt-4">
              <LoadChart weeks={stats.load} />
            </div>
          </Card>
          {profiles && (
            <Card className="gap-3">
              <div>
                <CardTitle>{t("team.profile360.title")}</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  {t("team.profile360.period")}
                </CardDescription>
              </div>
              <ProfileRadar
                name={displayName(user)}
                person={
                  profiles.scores.get(user.id) ?? {
                    onTime: null,
                    output: null,
                    noOverdue: null,
                    speed: null,
                    firstTime: null,
                  }
                }
                team={profiles.team}
              />
            </Card>
          )}
        </>
      )}

      {tab === "profile" && (
        <Card className="gap-3">
          <CardTitle>{t("team.profile.title")}</CardTitle>
          <form action={updateProfileAction} className="flex flex-col gap-3">
            {hidden}
            <div className="grid gap-3 md:grid-cols-2">
              <Label className="flex-col items-start">
                {t("team.profile.position")}
                {inChart ? (
                  <span className="flex flex-col py-2 font-normal">
                    {user.position ?? t("team.noPosition")}
                    {fromChart}
                  </span>
                ) : (
                  <Input
                    name="position"
                    maxLength={100}
                    defaultValue={user.position ?? ""}
                    disabled={!can("position")}
                  />
                )}
              </Label>
              <Label className="flex-col items-start">
                {t("team.profile.responsibility")}
                <Input
                  name="responsibility"
                  maxLength={300}
                  defaultValue={user.responsibility ?? ""}
                  disabled={!can("responsibility")}
                />
              </Label>
              <Label className="flex-col items-start">
                {t("team.profile.phone")}
                <Input
                  name="phone"
                  type="tel"
                  maxLength={40}
                  defaultValue={user.phone ?? ""}
                  disabled={!can("phone")}
                />
              </Label>
              <Label className="flex-col items-start">
                {t("team.profile.email")}
                <Input
                  name="email"
                  type="email"
                  maxLength={200}
                  defaultValue={user.email ?? ""}
                  disabled={!can("email")}
                />
              </Label>
              <Label className="flex-col items-start">
                {t("team.profile.startedAt")}
                <Input
                  name="startedAt"
                  type="date"
                  defaultValue={user.startedAt ? toDateString(user.startedAt) : ""}
                  disabled={!can("startedAt")}
                />
              </Label>
              <Label className="flex-col items-start">
                {t("team.profile.manager")}
                {can("managerId") ? (
                  <NativeSelect
                    name="managerId"
                    defaultValue={user.managerId ?? ""}
                    className="w-full"
                  >
                    <option value="">{t("team.profile.noManager")}</option>
                    {managers
                      .filter((m) => m.id !== user.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {personName(m)}
                        </option>
                      ))}
                  </NativeSelect>
                ) : (
                  <span className="flex flex-col py-2 font-normal">
                    {manager ? (
                      <Link className="underline" href={`/team/${manager.id}`}>
                        {personName(manager)}
                      </Link>
                    ) : (
                      t("team.profile.noManager")
                    )}
                    {inChart && fromChart}
                  </span>
                )}
              </Label>
            </div>
            {reports.length > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">{t("team.profile.reports")}: </span>
                {reports.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ", "}
                    <Link className="underline" href={`/team/${r.id}`}>
                      {personName(r)}
                    </Link>
                  </span>
                ))}
              </p>
            )}
            {orgPath && (
              <p className="text-muted-foreground text-xs">
                {t("team.org.inStructure")}:{" "}
                {seesChart ? (
                  <Link href="/team/structure" className="underline">
                    {orgPath.length ? orgPath.join(" › ") : t("team.org.title")}
                  </Link>
                ) : (
                  <span>{orgPath.length ? orgPath.join(" › ") : t("team.org.title")}</span>
                )}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              {t("team.since", { date: formatDay(toDateString(user.createdAt)) })}
            </p>
            {editable.length > 0 && (
              <Button type="submit" size="sm" className="self-start">
                {t("team.profile.save")}
              </Button>
            )}
          </form>
          {!stats && <p className="text-muted-foreground text-xs">{t("team.stats.hidden")}</p>}
        </Card>
      )}

      {tab === "notes" && notes && (
        <Card className="gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>{t("team.notes.title")}</CardTitle>
            <CardDescription>{t("team.notes.privacy")}</CardDescription>
          </div>
          {Object.values(EmployeeNoteKind).map((kind) => {
            const list = notes.filter((n) => n.kind === kind);
            return (
              <section key={kind} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t(`team.notes.kinds.${kind}`)}</h3>
                {list.length === 0 && (
                  <p className="text-muted-foreground text-xs">{t("team.notes.empty")}</p>
                )}
                {list.map((note) => (
                  <div
                    key={note.id}
                    className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="flex flex-col gap-0.5">
                      <p className="whitespace-pre-wrap">{note.text}</p>
                      <span className="text-muted-foreground text-xs">
                        {displayName(note.author)} · {formatDateTime(note.createdAt, timezone)}
                      </span>
                    </div>
                    {(note.authorId === viewer.id || viewer.role === "OWNER") && (
                      <form action={deleteNoteAction}>
                        {hidden}
                        <input type="hidden" name="noteId" value={note.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          {t("team.notes.delete")}
                        </Button>
                      </form>
                    )}
                  </div>
                ))}
                <form action={addNoteAction} className="flex gap-2">
                  {hidden}
                  <input type="hidden" name="kind" value={kind} />
                  <Textarea
                    name="text"
                    required
                    maxLength={5000}
                    rows={1}
                    className="min-h-9"
                    placeholder={t("team.notes.placeholder")}
                  />
                  <Button type="submit" variant="outline" size="sm" className="self-end">
                    {t("team.notes.add")}
                  </Button>
                </form>
              </section>
            );
          })}
        </Card>
      )}

      {tab === "manage" && (
        <Card className="gap-3">
          <CardTitle>{t("team.manage")}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {assignable.length > 0 && (
              <ConfirmAction
                label={t("team.changeRole")}
                title={t("team.changeRoleTitle")}
                hint={t(
                  user.role === "MANAGER" ? "team.changeRoleHintManager" : "team.changeRoleHint",
                )}
                confirm={t("team.changeRoleConfirm")}
                action={changeRoleAction}
                hidden={{ userId: user.id, back }}
                tone="default"
              >
                <NativeSelect
                  name="role"
                  defaultValue={user.role}
                  aria-label={t("team.inviteRole")}
                  className="w-full"
                >
                  {assignable.map((role) => (
                    <option key={role} value={role}>
                      {t(`roles.${role}`)}
                    </option>
                  ))}
                </NativeSelect>
              </ConfirmAction>
            )}
            {canTest && (
              <form action={sendTestNotificationAction}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="back" value={back} />
                <Button type="submit" variant="outline" size="sm">
                  {t("team.sendTest")}
                </Button>
              </form>
            )}
            {deactivatable && !off && (
              <ConfirmAction
                label={t("team.deactivation.deactivate")}
                title={t("team.deactivation.confirmTitle")}
                hint={t("team.deactivation.hint")}
                confirm={t("team.deactivation.confirm")}
                action={deactivateUserAction}
                hidden={{ employeeId: user.id }}
                floating
              >
                <span className="text-sm">
                  {t("team.deactivation.openTasks", { count: openTasks })}
                </span>
                {openTasks > 0 && (
                  <Label className="flex-col items-start text-xs">
                    {t("team.deactivation.handOver")}
                    <NativeSelect name="handOverTo" defaultValue={defaultHeir} className="w-full">
                      <option value="">{t("team.deactivation.handOverNone")}</option>
                      {heirOptions.map((h) => (
                        <option key={h.id} value={h.id}>
                          {displayName(h)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                )}
                {openTasks > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {t("team.deactivation.handOverHint")}
                  </span>
                )}
              </ConfirmAction>
            )}
            {deactivatable && off && (
              <ConfirmAction
                label={t("team.deactivation.reactivate")}
                title={t("team.deactivation.reactivateTitle")}
                hint={t("team.deactivation.reactivateHint")}
                confirm={t("team.deactivation.reactivateConfirm")}
                action={reactivateUserAction}
                hidden={{ employeeId: user.id }}
                tone="default"
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

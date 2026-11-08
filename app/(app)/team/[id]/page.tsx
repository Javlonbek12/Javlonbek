import Link from "next/link";
import { notFound } from "next/navigation";

import { LoadChart } from "@/components/team/load-chart";
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
import { requireUser } from "@/modules/core/auth/current-user";
import { canChangeRole, canSendTestNotification } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName, personName } from "@/modules/core/users/display-name";
import { orgPathOf } from "@/modules/org/service";
import { listAssignableUsers } from "@/modules/tasks/service";
import { canDeactivate } from "@/modules/team/deactivation";
import { teamProfiles } from "@/modules/team/profile";
import { getEmployeeCard, listManagerCandidates } from "@/modules/team/service";
import { ProfileRadar } from "@/components/team/profile-radar";

import { changeRoleAction, sendTestNotificationAction } from "../../actions";
import {
  addNoteAction,
  deactivateUserAction,
  deleteNoteAction,
  reactivateUserAction,
  updateProfileAction,
} from "../actions";

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="bg-muted/50 flex flex-col gap-0.5 rounded-lg p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("text-xl font-semibold", alert && "text-destructive")}>{value}</span>
    </div>
  );
}

export default async function EmployeePage({ params, searchParams }: PageProps<"/team/[id]">) {
  const viewer = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const card = await getEmployeeCard(viewer, id);
  if (!card) notFound();
  const { user, manager, reports, stats, notes, editable, inChart } = card;
  // Links only where the viewer can go: the chart is a separate section.
  const seesChart = canUseModule(viewer, "structure");
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
  const [{ timezone }, managers, orgPath, heirs] = await Promise.all([
    getSettings(viewer.id),
    // The current manager stays in the list even if deactivated, so saving keeps them.
    listManagerCandidates(user.managerId),
    orgPathOf(user.id),
    deactivatable && !off ? listAssignableUsers() : Promise.resolve([]),
  ]);
  // The radar is shown to the same people who may see the statistics.
  const profiles = stats ? await teamProfiles(timezone) : null;
  const can = (field: (typeof editable)[number]) => editable.includes(field);
  const assignable = (["MANAGER", "MEMBER", "LAWYER"] as const).filter((role) =>
    canChangeRole(viewer, user, role),
  );
  const hidden = <input type="hidden" name="employeeId" value={user.id} />;
  const pct = (value: number | null) => (value === null ? t("team.stats.noData") : `${value}%`);

  return (
    <div className="flex flex-col gap-4">
      {query.saved && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("team.profile.saved")}
        </p>
      )}
      {query.notice === "testSent" && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("team.testSent")}
        </p>
      )}
      {query.deactivated && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("team.deactivation.done", { moved: Number(query.moved) || 0 })}
          {Number(query.notMoved) > 0 &&
            ` ${t("team.deactivation.notMoved", { count: Number(query.notMoved) })}`}
        </p>
      )}
      {query.reactivated && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("team.deactivation.reactivated")}
        </p>
      )}
      {typeof query.error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {query.error === "manager"
            ? t("team.profile.errorManager")
            : query.error === "invalid"
              ? t("team.profile.errorInvalid")
              : query.error === "self" ||
                  query.error === "lastOwner" ||
                  query.error === "handOver" ||
                  query.error === "state"
                ? t(`team.deactivation.errors.${query.error}`)
                : t("errors.forbidden")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[22px] font-medium md:text-2xl">{displayName(user)}</h1>
        <Badge variant={user.role === "OWNER" ? "default" : "secondary"}>
          {t(`roles.${user.role}`)}
        </Badge>
        {off && <Badge variant="outline">{t("team.deactivation.badge")}</Badge>}
      </div>
      {user.deactivatedAt && (
        <p className="bg-muted rounded-md p-3 text-sm">
          {t("team.deactivation.off", { date: formatDay(toDateString(user.deactivatedAt)) })}
        </p>
      )}
      <p className="text-muted-foreground -mt-2 text-sm">
        {user.position ?? t("team.noPosition")}
        {user.telegramUsername && ` · @${user.telegramUsername}`}
      </p>
      {orgPath && (
        <p className="text-muted-foreground -mt-3 text-xs">
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

      {stats ? (
        <Card className="gap-3">
          <CardTitle>{t("team.stats.title")}</CardTitle>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label={t("team.stats.active")} value={String(stats.active)} />
            <Stat
              label={t("team.stats.overdue")}
              value={String(stats.overdue)}
              alert={stats.overdue > 0}
            />
            <Stat label={t("team.stats.onTime30")} value={pct(stats.onTime30.percent)} />
            <Stat label={t("team.stats.onTime90")} value={pct(stats.onTime90.percent)} />
            <Stat
              label={t("team.stats.averageDays")}
              value={
                stats.averageDays === null
                  ? t("team.stats.noData")
                  : t("team.stats.days", { value: stats.averageDays })
              }
            />
          </div>
          {stats.onTime90.total > 0 && (
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
      ) : (
        <p className="text-muted-foreground text-sm">{t("team.stats.hidden")}</p>
      )}

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
          {editable.length > 0 && (
            <Button type="submit" size="sm" className="self-start">
              {t("team.profile.save")}
            </Button>
          )}
        </form>
      </Card>

      {notes && (
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

      {(assignable.length > 0 || canSendTestNotification(viewer, user.id) || deactivatable) && (
        <Card className="gap-3">
          <CardTitle>{t("team.manage")}</CardTitle>
          <p className="text-muted-foreground text-xs">
            {t("team.since", { date: formatDay(toDateString(user.createdAt)) })} ·{" "}
            {user.botChatId ? t("team.botLinked") : t("team.botNotLinked")}
          </p>
          <div className="flex flex-wrap gap-2">
            {assignable.length > 0 && (
              <form action={changeRoleAction} className="flex gap-2">
                <input type="hidden" name="userId" value={user.id} />
                <NativeSelect
                  name="role"
                  defaultValue={user.role}
                  aria-label={t("team.changeRole")}
                >
                  {assignable.map((role) => (
                    <option key={role} value={role}>
                      {t(`roles.${role}`)}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="submit" variant="outline" size="sm">
                  {t("team.changeRole")}
                </Button>
              </form>
            )}
            {canSendTestNotification(viewer, user.id) && !off && (
              <form action={sendTestNotificationAction}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="back" value={`/team/${user.id}`} />
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
              >
                <Label className="flex-col items-start text-xs">
                  {t("team.deactivation.handOver")}
                  <NativeSelect name="handOverTo" defaultValue="" className="w-full">
                    <option value="">{t("team.deactivation.handOverNone")}</option>
                    {heirs
                      .filter((h) => h.id !== user.id)
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {displayName(h)}
                        </option>
                      ))}
                  </NativeSelect>
                </Label>
                <span className="text-muted-foreground text-xs">
                  {t("team.deactivation.handOverHint")}
                </span>
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

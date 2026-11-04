import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { t, type TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { listDeletedTasks } from "@/modules/tasks/delete-service";
import { getTaskSettings } from "@/modules/tasks/settings";

import { restoreTaskAction } from "../actions";

// The bin: team tasks deleted in the last days (routing v2). Only the owner sees it and brings
// tasks back; after the days set in the settings they are gone for good.
export default async function TaskTrashPage({ searchParams }: PageProps<"/tasks/trash">) {
  const user = await requireUser();
  if (user.role !== "OWNER") notFound();
  const { error } = await searchParams;
  const [rows, settings, { trashDays }] = await Promise.all([
    listDeletedTasks(user),
    getSettings(user.id),
    getTaskSettings(),
  ]);
  const tz = settings.timezone;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-medium">{t("tasks.trash.title")}</h2>
        <p className="text-muted-foreground text-sm">
          {t("tasks.trash.hint", { days: trashDays })}
        </p>
      </div>
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`tasks.errors.${error}` as TranslationKey, { mb: 20 })}
        </p>
      )}
      {rows.length === 0 && (
        <p className="text-muted-foreground bg-card rounded-2xl border p-6 text-center text-sm">
          {t("tasks.trash.empty")}
        </p>
      )}
      {rows.map((row) => (
        <Card key={row.id} className="flex-row items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 flex-col gap-0.5 text-sm">
            <span className="font-medium break-words">{row.title}</span>
            <span className="text-muted-foreground text-xs">
              {t("tasks.trash.deleted", {
                name: row.deletedBy ? displayName(row.deletedBy) : "—",
                date: formatDateTime(row.deletedAt, tz),
              })}
            </span>
            {row.reason && (
              <span className="text-muted-foreground text-xs">
                {t("tasks.remove.pendingReason", { reason: row.reason })}
              </span>
            )}
            <span className="text-muted-foreground text-xs">
              {t("tasks.trash.purge", { date: formatDateTime(row.purgeAt, tz) })}
            </span>
          </div>
          <form action={restoreTaskAction}>
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" size="sm" variant="outline">
              {t("tasks.trash.restore")}
            </Button>
          </form>
        </Card>
      ))}
    </div>
  );
}

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConnectUploadForm } from "@/components/connect/upload-form";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import type { ConnectKind } from "@/lib/generated/prisma/enums";
import { dateFormat, t } from "@/lib/i18n";
import { canLeadConnect, connectFacets, lastImports } from "@/modules/connect/service";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { formatRange } from "@/modules/reports/format";
import { todayInTimezone } from "@/lib/dates";

import { clearConnectAction, importConnectFileAction } from "../actions";

const ERRORS = ["forbidden", "empty", "unknown", "tooBig"] as const;
const KINDS = ["OOS", "ORDER", "PAYMENT", "VISIT"] as const satisfies ConnectKind[];

// Upload the Connect bot's Excel exports; recent uploads and (for the owner) a full reset.
export default async function ConnectImportPage({ searchParams }: PageProps<"/connect/import">) {
  const user = await requireUser();
  if (!canLeadConnect(user)) redirect("/connect");
  const params = await searchParams;
  const error = ERRORS.find((e) => e === params.error);
  const done = typeof params.done === "string" ? params.done.split("\n").filter(Boolean) : [];
  const [imports, facets, { timezone }] = await Promise.all([
    lastImports(),
    connectFacets(),
    getSettings(user.id),
  ]);
  // Times in the viewer's time zone, not the server's.
  const when = dateFormat({ dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const today = todayInTimezone(timezone);
  // The bot's own times are Tashkent time (UTC+5, no summer time).
  const stamp = (value: string) => when.format(new Date(`${value}:00+05:00`));
  const kindName = (kind: string) =>
    KINDS.includes(kind as ConnectKind) ? t(`connect.kinds.${kind as ConnectKind}`) : kind;

  return (
    <div className="flex max-w-3xl flex-col gap-5 [&>*]:min-w-0">
      <Link
        href="/connect"
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("connect.import.back")}
      </Link>
      <h1 className="text-[22px] font-medium md:text-2xl">{t("connect.import.title")}</h1>

      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`connect.import.errors.${error}`)}
        </p>
      )}
      {done.length > 0 && (
        <div role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm">
          <p className="font-medium">{t("connect.import.done")}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {done.map((line) => {
              const [
                file = "",
                kind = "",
                created = "0",
                updated = "0",
                skipped = "0",
                kept = "0",
                newer = "",
                from = "",
                to = "",
                test = "0",
              ] = line.split("|");
              return (
                <li key={line}>
                  {t("connect.import.result", { file, kind: kindName(kind), created, updated })}
                  {skipped !== "0" && `; ${t("connect.import.skipped", { count: skipped })}`}
                  {(from || test !== "0") && (
                    <span className="text-muted-foreground block text-xs">
                      {[
                        from &&
                          to &&
                          t("connect.import.range", { range: formatRange(from, to, today) }),
                        test !== "0" && t("connect.import.testRows", { count: test }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {newer && (
                    <span className="mt-0.5 block font-medium text-amber-700 dark:text-amber-300">
                      {t("connect.import.older", { date: stamp(newer), count: kept })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <Button asChild size="sm" className="mt-3">
            <Link href="/connect">{t("connect.import.open")}</Link>
          </Button>
        </div>
      )}
      {params.cleared && (
        <p role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm">
          {t("connect.import.cleared")}
        </p>
      )}

      <Card className="gap-3">
        <CardDescription>{t("connect.import.hint")}</CardDescription>
        <ul className="text-muted-foreground list-disc pl-5 text-sm">
          {KINDS.map((kind) => (
            <li key={kind}>{t(`connect.kinds.${kind}`)}</li>
          ))}
        </ul>
        <ConnectUploadForm action={importConnectFileAction} />
      </Card>

      <Card className="gap-3">
        <CardTitle>{t("connect.import.history")}</CardTitle>
        <CardDescription>{t("connect.import.total", { count: facets.total })}</CardDescription>
        {imports.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("connect.import.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {imports.map((i) => (
              <li key={i.id} className="flex flex-col gap-0.5 py-2">
                <span className="break-all">{i.fileName}</span>
                <span className="text-muted-foreground text-xs">
                  {when.format(i.createdAt)} · {i.kinds.split(",").map(kindName).join(", ")} ·{" "}
                  {t("connect.import.historyRow", { created: i.created, updated: i.updated })}
                  {i.kept > 0 && ` · ${t("connect.import.historyKept", { count: i.kept })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {user.role === "OWNER" && facets.total > 0 && (
        <Card className="gap-3">
          <CardTitle>{t("connect.import.clear")}</CardTitle>
          <CardDescription>{t("connect.import.clearHint")}</CardDescription>
          <ConfirmAction
            label={t("connect.import.clearConfirm")}
            title={t("connect.import.clearQuestion", { count: facets.total })}
            hint={t("connect.import.clearHint")}
            confirm={t("connect.import.clearYes")}
            action={clearConnectAction}
          />
        </Card>
      )}
    </div>
  );
}

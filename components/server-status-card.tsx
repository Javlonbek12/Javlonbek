import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { RefreshButton } from "@/components/settings/refresh-button";
import { Card, CardTitle } from "@/components/ui/card";
import { intlLocale, t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  getServerStatus,
  serverWarnings,
  type ServerStatus,
  type ServerWarning,
} from "@/modules/ops/server-status";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function size(bytes: number) {
  const nf = (n: number, digits: number) =>
    new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: digits }).format(n);
  if (bytes >= GB) return t("common.gb", { n: nf(bytes / GB, bytes >= 10 * GB ? 0 : 1) });
  return t("common.mb", { n: nf(Math.max(bytes / MB, 0.1), bytes >= 10 * MB ? 0 : 1) });
}

const pct = (share: number) =>
  new Intl.NumberFormat(intlLocale(), { style: "percent", maximumFractionDigits: 0 }).format(share);

// A backup stamp (2026-11-08_0300, the server's clock is UTC) as a moment.
function stampDate(stamp: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(stamp);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
}

const diskShare = (status: ServerStatus) =>
  status.disk && status.disk.total > 0 ? 1 - status.disk.free / status.disk.total : null;

// One line for the settings page: all well, or the most serious problem.
export function serverSummary(status: ServerStatus, warnings: ServerWarning[]) {
  if (warnings.length === 0) return { ok: true, text: t("settings.server.summaryOk") };
  const share = diskShare(status);
  return {
    ok: false,
    text:
      warnings[0] === "diskHigh" && share !== null
        ? t("settings.server.answers.diskFull", { share: pct(share) })
        : t(`settings.server.warnings.${warnings[0]!}`),
  };
}

function Answer({
  tone,
  title,
  children,
}: {
  tone: "ok" | "warn" | "info";
  title: string;
  children?: React.ReactNode;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : Info;
  return (
    <div
      role={tone === "warn" ? "alert" : undefined}
      className={cn(
        "flex gap-3 rounded-xl border p-3",
        tone === "warn" && "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          tone === "ok" && "text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "info" && "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="flex flex-col gap-0.5 text-sm">
        <p className="font-medium">{title}</p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums">{value}</p>
    </div>
  );
}

// OWNER-only: answers first — are the data saved, is there room on the disk — then the server in
// plain words, the technical details folded away.
export async function ServerStatusCard({ timezone }: { timezone: string }) {
  const status = await getServerStatus();
  const warnings = serverWarnings(status);
  const share = diskShare(status);
  const memUsed = status.memory.total - status.memory.available;
  const days = Math.floor(status.uptimeSeconds / 86_400);
  const hours = Math.floor((status.uptimeSeconds % 86_400) / 3600);
  const cloudAt = status.cloud ? stampDate(status.cloud.latest) : null;
  const latest = status.backups?.latest ?? null;
  const cloudFresh = status.cloud && !warnings.includes("cloudStale");
  const load = (n: number) =>
    new Intl.NumberFormat(intlLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  const backupAnswer =
    status.backups === null ? (
      <Answer tone="info" title={t("settings.server.noFolder")} />
    ) : !latest ? (
      <Answer tone="warn" title={t("settings.server.answers.noBackups")}>
        {t("settings.server.answers.noBackupsHint")}
      </Answer>
    ) : (
      <Answer
        tone={warnings.includes("backupStale") || !cloudFresh ? "warn" : "ok"}
        title={
          warnings.includes("backupStale")
            ? t("settings.server.answers.stale")
            : t("settings.server.answers.saved")
        }
      >
        {t(cloudFresh ? "settings.server.answers.both" : "settings.server.answers.serverOnly", {
          at: formatDateTime(latest.at, timezone),
        })}
        {!cloudFresh && ` ${t("settings.server.answers.cloudHint")}`}
      </Answer>
    );

  return (
    <Card className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("settings.server.title")}</CardTitle>
        <RefreshButton />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {backupAnswer}
        {share !== null &&
          (warnings.includes("diskHigh") ? (
            <Answer
              tone="warn"
              title={t("settings.server.answers.diskFull", { share: pct(share) })}
            >
              {t("settings.server.answers.diskHint")}
            </Answer>
          ) : (
            <Answer tone="ok" title={t("settings.server.answers.diskOk", { share: pct(share) })} />
          ))}
        {warnings.includes("memoryLow") && (
          <Answer tone="warn" title={t("settings.server.warnings.memoryLow")} />
        )}
        {warnings.includes("cpuHigh") && (
          <Answer tone="warn" title={t("settings.server.warnings.cpuHigh")} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile
          label={t("settings.server.memory")}
          value={t("settings.server.ofTotal", {
            used: size(memUsed),
            total: size(status.memory.total),
          })}
        />
        <Tile
          label={t("settings.server.cpu")}
          value={t(
            warnings.includes("cpuHigh") ? "settings.server.cpuBusy" : "settings.server.cpuCalm",
          )}
        />
        <Tile
          label={t("settings.server.uptime")}
          value={t("settings.server.uptimeValue", { days, hours })}
        />
        {status.databaseBytes !== null && (
          <Tile label={t("settings.server.database")} value={size(status.databaseBytes)} />
        )}
      </div>

      <details className="text-sm">
        <summary className="text-muted-foreground w-fit cursor-pointer hover:underline">
          {t("settings.server.details")}
        </summary>
        <div className="text-muted-foreground mt-2 flex flex-col gap-1.5">
          {status.disk && (
            <p>
              {t("settings.server.disk")}:{" "}
              {t("settings.server.ofTotal", {
                used: size(status.disk.total - status.disk.free),
                total: size(status.disk.total),
              })}
              ,{" "}
              {t("settings.server.free", {
                size: size(status.disk.free),
                share: pct(1 - (share ?? 0)),
              })}
            </p>
          )}
          <p>
            {t("settings.server.cpu")}: {t("settings.server.cores", { n: status.cores })},{" "}
            {t("settings.server.load", {
              one: load(status.load[0]),
              five: load(status.load[1]),
              fifteen: load(status.load[2]),
            })}
          </p>
          {status.version && (
            <p>
              {t("settings.server.version")}: {status.version.split(" ").slice(0, 2).join(" · ")}
            </p>
          )}
          {status.backups && (
            <p>
              {t("settings.server.onServer")}:{" "}
              {latest
                ? t("settings.server.serverCopy", {
                    at: formatDateTime(latest.at, timezone),
                    database: size(latest.databaseBytes),
                    files: size(latest.uploadsBytes),
                    count: status.backups.count,
                    total: size(status.backups.totalBytes),
                  })
                : t("settings.server.none")}
            </p>
          )}
          {status.backups && (
            <p>
              {t("settings.server.inCloud")}:{" "}
              {status.cloud
                ? t("settings.server.cloudCopy", {
                    at: cloudAt ? formatDateTime(cloudAt, timezone) : status.cloud.latest,
                    size: size(status.cloud.bytes),
                    count: status.cloud.copies,
                    checked: formatDateTime(status.cloud.checkedAt, timezone),
                  })
                : t("settings.server.cloudOff")}
            </p>
          )}
          <p className="text-xs">{t("settings.server.more")}</p>
        </div>
      </details>
    </Card>
  );
}

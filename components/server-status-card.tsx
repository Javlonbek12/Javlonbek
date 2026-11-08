import { AlertTriangle } from "lucide-react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { intlLocale, t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { getServerStatus, serverWarnings } from "@/modules/ops/server-status";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function size(bytes: number) {
  const nf = (n: number, digits: number) =>
    new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: digits }).format(n);
  if (bytes >= GB) return t("common.gb", { n: nf(bytes / GB, bytes >= 10 * GB ? 0 : 1) });
  return t("common.mb", { n: nf(Math.max(bytes / MB, 0.1), bytes >= 10 * MB ? 0 : 1) });
}

// A backup stamp (2026-11-08_0300, the server's clock is UTC) as a moment.
function stampDate(stamp: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(stamp);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
}

function Meter({ share, warn }: { share: number; warn: boolean }) {
  return (
    <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full" aria-hidden>
      <div
        className={cn("h-full rounded-full", warn ? "bg-amber-500" : "bg-primary")}
        style={{ width: `${Math.min(100, Math.max(2, share * 100))}%` }}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-muted/40 rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums">{value}</p>
      {children}
      {hint && <p className="text-muted-foreground mt-1 text-xs tabular-nums">{hint}</p>}
    </div>
  );
}

// OWNER-only: the server (disk, memory, processor) and the backups, on the server and in the cloud.
export async function ServerStatusCard({ timezone }: { timezone: string }) {
  const status = await getServerStatus();
  const warnings = serverWarnings(status);
  const pct = (share: number) =>
    new Intl.NumberFormat(intlLocale(), { style: "percent", maximumFractionDigits: 0 }).format(
      share,
    );
  const load = (n: number) =>
    new Intl.NumberFormat(intlLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  const diskUsed = status.disk ? status.disk.total - status.disk.free : 0;
  const diskShare = status.disk && status.disk.total > 0 ? diskUsed / status.disk.total : 0;
  const memUsed = status.memory.total - status.memory.available;
  const memShare = status.memory.total > 0 ? memUsed / status.memory.total : 0;
  const days = Math.floor(status.uptimeSeconds / 86_400);
  const hours = Math.floor((status.uptimeSeconds % 86_400) / 3600);
  const cloudAt = status.cloud ? stampDate(status.cloud.latest) : null;

  return (
    <Card className="gap-3">
      <CardTitle>{t("settings.server.title")}</CardTitle>
      <CardDescription>{t("settings.server.hint")}</CardDescription>

      {warnings.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
          {warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t(`settings.server.warnings.${w}`)}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {status.disk && (
          <Tile
            label={t("settings.server.disk")}
            value={t("settings.server.ofTotal", {
              used: size(diskUsed),
              total: size(status.disk.total),
            })}
            hint={t("settings.server.free", {
              size: size(status.disk.free),
              share: pct(1 - diskShare),
            })}
          >
            <Meter share={diskShare} warn={warnings.includes("diskHigh")} />
          </Tile>
        )}
        <Tile
          label={t("settings.server.memory")}
          value={t("settings.server.ofTotal", {
            used: size(memUsed),
            total: size(status.memory.total),
          })}
          hint={t("settings.server.available", { size: size(status.memory.available) })}
        >
          <Meter share={memShare} warn={warnings.includes("memoryLow")} />
        </Tile>
        <Tile
          label={t("settings.server.cpu")}
          value={t("settings.server.cores", { n: status.cores })}
          hint={t("settings.server.load", {
            one: load(status.load[0]),
            five: load(status.load[1]),
            fifteen: load(status.load[2]),
          })}
        />
        <Tile
          label={t("settings.server.uptime")}
          value={t("settings.server.uptimeValue", { days, hours })}
        />
        {status.databaseBytes !== null && (
          <Tile label={t("settings.server.database")} value={size(status.databaseBytes)} />
        )}
        {status.version && (
          <Tile
            label={t("settings.server.version")}
            value={status.version.split(" ").slice(0, 2).join(" · ")}
          />
        )}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <h3 className="font-medium">{t("settings.server.backups")}</h3>
        {status.backups === null ? (
          <p className="text-muted-foreground">{t("settings.server.noFolder")}</p>
        ) : (
          <>
            <p>
              <span className="text-muted-foreground">{t("settings.server.onServer")}: </span>
              {status.backups.latest
                ? t("settings.server.serverCopy", {
                    at: formatDateTime(status.backups.latest.at, timezone),
                    database: size(status.backups.latest.databaseBytes),
                    files: size(status.backups.latest.uploadsBytes),
                    count: status.backups.count,
                    total: size(status.backups.totalBytes),
                  })
                : t("settings.server.none")}
            </p>
            <p>
              <span className="text-muted-foreground">{t("settings.server.inCloud")}: </span>
              {status.cloud
                ? t("settings.server.cloudCopy", {
                    at: cloudAt ? formatDateTime(cloudAt, timezone) : status.cloud.latest,
                    size: size(status.cloud.bytes),
                    count: status.cloud.copies,
                    checked: formatDateTime(status.cloud.checkedAt, timezone),
                  })
                : t("settings.server.cloudOff")}
            </p>
          </>
        )}
        <p className="text-muted-foreground text-xs">{t("settings.server.more")}</p>
      </div>
    </Card>
  );
}

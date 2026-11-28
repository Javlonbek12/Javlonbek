import Link from "next/link";

import { SopUploadForm } from "@/components/sop/upload-form";
import { Chip } from "@/components/sop/parts";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { formatNumber } from "@/lib/format";
import { dateFormat, t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { loadSopData } from "@/modules/sop/load";
import { MAX_SOP_FILE_MB } from "@/modules/sop/parse";
import { monthLabel } from "@/modules/sop/texts";
import { isMonth } from "@/modules/sop/types";

import {
  deleteSopUploadAction,
  inspectSopFileAction,
  pickSopUploadAction,
  uploadSopAction,
} from "../actions";

const ERRORS = ["forbidden", "notFound"] as const;

const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? t("common.mb", { n: formatNumber(bytes / 1024 / 1024, 1) })
    : t("common.kb", { n: formatNumber(bytes / 1024, 0) });

// «Загрузки»: upload a file of the month, and every file uploaded so far.
export default async function SopUploadsPage({ searchParams }: PageProps<"/sop/uploads">) {
  const user = await requireUser();
  const [data, { timezone }, params] = await Promise.all([
    loadSopData(),
    getSettings(user.id),
    searchParams,
  ]);
  const { uploads, upload: shown, settings } = data;
  const when = dateFormat({ dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const error = ERRORS.find((code) => code === params.error);
  const [doneCycle, doneSkus] = typeof params.done === "string" ? params.done.split("|") : [];
  return (
    <div className="flex max-w-3xl flex-col gap-5 [&>*]:min-w-0">
      <p className="text-muted-foreground text-sm">{t("sop.uploads.intro")}</p>
      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`sop.uploads.errors.${error}` as TranslationKey)}
        </p>
      )}
      {isMonth(doneCycle) && (
        <div role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm">
          <p className="font-medium">
            {t("sop.uploads.done", {
              cycle: monthLabel(doneCycle),
              skus: Number(doneSkus) || 0,
            })}
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link href="/sop">{t("sop.uploads.open")}</Link>
          </Button>
        </div>
      )}
      {params.deleted && (
        <p role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm">
          {t("sop.uploads.deleted")}
        </p>
      )}

      <Card className="gap-3">
        <SopUploadForm
          inspect={inspectSopFileAction}
          upload={uploadSopAction}
          market={settings.market}
          maxMb={MAX_SOP_FILE_MB}
        />
      </Card>

      <Card className="gap-3">
        <CardTitle>{t("sop.uploads.list")}</CardTitle>
        {uploads.length === 0 ? (
          <CardDescription>{t("sop.uploads.none")}</CardDescription>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {uploads.map((u, index) => (
              <li key={u.id} className="flex flex-col gap-1.5 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{monthLabel(u.cycle)}</span>
                  <span>{t(`sop.kinds.${u.kind}`)}</span>
                  {index === 0 && <Chip tone="good">{t("sop.uploads.current")}</Chip>}
                  {u.id === shown?.id && <Chip>{t("sop.uploads.shown")}</Chip>}
                </span>
                <span className="break-all">{u.fileName}</span>
                <span className="text-muted-foreground text-xs">
                  {t("sop.uploads.by", {
                    name: u.uploaderName ?? "—",
                    date: when.format(u.createdAt),
                  })}
                  {" · "}
                  {t("sop.uploads.row", { skus: u.skuCount, size: size(u.fileSize) })}
                </span>
                {u.note && <span className="text-muted-foreground text-xs">«{u.note}»</span>}
                <span className="flex flex-wrap items-center gap-2">
                  {u.id !== shown?.id && (
                    <form action={pickSopUploadAction}>
                      <input type="hidden" name="uploadId" value={u.id} />
                      <input type="hidden" name="back" value="/sop" />
                      <Button type="submit" size="sm" variant="outline">
                        {t("sop.uploads.show")}
                      </Button>
                    </form>
                  )}
                  <ConfirmAction
                    label={t("sop.uploads.delete")}
                    title={t("sop.uploads.deleteQuestion")}
                    hint={t("sop.uploads.deleteHint")}
                    confirm={t("sop.uploads.deleteYes")}
                    action={deleteSopUploadAction}
                    hidden={{ uploadId: u.id }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

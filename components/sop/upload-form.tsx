"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { SopInspectResult, SopUploadResult } from "@/app/(app)/sop/actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { TranslationKey } from "@/lib/i18n";

const KINDS = ["OURS", "HQ_DRAFT", "HQ_FINAL"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]}'${month.slice(2, 4)}`;

// Two steps: the chosen file is read first, and what was found in it (the sheet, the cycle) is
// shown; then the person says what kind of file it is, corrects the cycle if needed, and saves.
export function SopUploadForm({
  inspect,
  upload,
  market,
  maxMb,
}: {
  inspect: (form: FormData) => Promise<SopInspectResult>;
  upload: (form: FormData) => Promise<SopUploadResult>;
  // For the texts of the errors: the market whose sheet is read, the largest file taken.
  market: string;
  maxMb: number;
}) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<Extract<SopInspectResult, { ok: true }> | null>(null);
  const [cycle, setCycle] = useState("");
  const [busy, setBusy] = useState<"check" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (code: string) =>
    setError(t(`sop.uploads.errors.${code}` as TranslationKey, { market, mb: maxMb }));
  const chosen = () => {
    const file = input.current?.files?.[0];
    if (!file) return (fail("empty"), null);
    if (file.size > maxMb * 1024 * 1024) return (fail("tooBig"), null);
    return file;
  };

  async function check() {
    const file = chosen();
    if (!file) return;
    setError(null);
    setBusy("check");
    const form = new FormData();
    form.set("file", file);
    const result = await inspect(form).catch(() => ({ ok: false as const, error: "failed" }));
    setBusy(null);
    if (!result.ok) return fail(result.error);
    setFound(result);
    setCycle(result.cycle ?? "");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = chosen();
    if (!file || !found) return;
    const data = new FormData(event.currentTarget);
    if (!cycle) return fail("cycle");
    setError(null);
    setBusy("upload");
    const form = new FormData();
    form.set("file", file);
    form.set("kind", String(data.get("kind") ?? ""));
    form.set("note", String(data.get("note") ?? ""));
    form.set("cycle", cycle);
    const result = await upload(form).catch(() => ({ ok: false as const, error: "failed" }));
    setBusy(null);
    if (!result.ok) return fail(result.error);
    router.push(`/sop/uploads?done=${result.cycle}|${result.skus}`);
    router.refresh();
    setFound(null);
    if (input.current) input.current.value = "";
  }

  const reset = () => {
    setFound(null);
    setError(null);
  };
  // The months a cycle may be: every month of the sheet but the first (it needs a closed month
  // before it), the latest first.
  const cycles = found ? found.months.slice(1).reverse() : [];
  const named = found?.fileDate?.slice(0, 7) ?? null;

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("sop.uploads.form.file")}
        <Input
          ref={input}
          type="file"
          name="file"
          required
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="h-auto py-1.5 font-normal"
          onChange={reset}
        />
      </label>

      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {error}
        </p>
      )}

      {!found ? (
        <div>
          <Button type="button" onClick={check} disabled={busy !== null}>
            {busy === "check" ? t("sop.uploads.form.checking") : t("sop.uploads.form.check")}
          </Button>
        </div>
      ) : (
        <>
          <div role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm">
            <p>
              {t("sop.uploads.form.found", {
                sheet: found.sheet,
                skus: found.skus,
                from: monthLabel(found.months[0]!),
                to: monthLabel(found.months.at(-1)!),
              })}
            </p>
            <p className="text-muted-foreground">
              {found.materials === null
                ? t("sop.uploads.form.noMaterials")
                : t("sop.uploads.form.materials", { count: found.materials })}
            </p>
          </div>

          <label className="flex flex-col gap-1 text-sm font-medium">
            {t("sop.uploads.form.cycle")}
            <NativeSelect
              name="cycle"
              value={cycle}
              onChange={(e) => setCycle(e.currentTarget.value)}
              className="w-fit font-normal"
              required
            >
              {!cycle && <option value="">—</option>}
              {cycles.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </NativeSelect>
            <span className="text-muted-foreground text-xs font-normal">
              {found.detected && found.lastActual
                ? t("sop.uploads.form.cycleDetected", { closed: monthLabel(found.lastActual) })
                : found.cycle && found.fileDate
                  ? t("sop.uploads.form.cycleFromName", { date: found.fileDate })
                  : t("sop.uploads.form.cycleUnknown")}
            </span>
            {found.detected && named && named !== found.detected && (
              <span className="text-xs font-normal text-amber-700 dark:text-amber-300">
                {t("sop.uploads.form.cycleMismatch", {
                  date: found.fileDate ?? "",
                  cycle: monthLabel(found.detected),
                })}
              </span>
            )}
          </label>

          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1 font-medium">{t("sop.uploads.form.kind")}</legend>
            {KINDS.map((kind, index) => (
              <label key={kind} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="kind"
                  value={kind}
                  defaultChecked={index === 0}
                  className="size-4"
                />
                {t(`sop.kinds.${kind}`)}
              </label>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1 text-sm font-medium">
            {t("sop.uploads.form.note")}
            <Input
              name="note"
              maxLength={500}
              placeholder={t("sop.uploads.form.notePlaceholder")}
              className="max-w-xl font-normal"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy !== null}>
              {busy === "upload" ? t("sop.uploads.form.uploading") : t("sop.uploads.form.submit")}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

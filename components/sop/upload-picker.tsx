"use client";

import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";
import { NativeSelect } from "@/components/ui/native-select";

// The pages that have no upload on screen: the picker is not shown there.
const HIDDEN_ON = ["/sop/uploads", "/sop/settings", "/sop/guide", "/sop/compare"];

// Which upload the pages show: picking one reloads the page for it at once. `note` says which
// months the upload covers; `stale` — that it is not the latest one.
export function UploadPicker({
  uploads,
  current,
  note,
  stale,
  action,
}: {
  uploads: { id: string; label: string }[];
  current: string;
  note?: string;
  stale: boolean;
  action: (form: FormData) => Promise<void>;
}) {
  const t = useT();
  const pathname = usePathname();
  if (HIDDEN_ON.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null;
  return (
    <div className="flex flex-col gap-1 print:hidden">
      <form action={action} className="flex min-w-0 items-center gap-2 text-sm">
        <input type="hidden" name="back" value={pathname} />
        <span className="text-muted-foreground shrink-0">{t("sop.picker.label")}</span>
        <NativeSelect
          name="uploadId"
          defaultValue={current}
          key={current}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          aria-label={t("sop.picker.label")}
          className="w-full min-w-0 sm:w-auto sm:max-w-xl"
        >
          {uploads.map((upload) => (
            <option key={upload.id} value={upload.id}>
              {upload.label}
            </option>
          ))}
        </NativeSelect>
        <button type="submit" className="sr-only">
          {t("sop.picker.open")}
        </button>
      </form>
      {(note || stale) && (
        <p className="text-muted-foreground text-xs">
          {stale && (
            <span className="font-medium text-amber-700 dark:text-amber-300">
              {t("sop.picker.notCurrent")}{" "}
            </span>
          )}
          {note}
        </p>
      )}
    </div>
  );
}

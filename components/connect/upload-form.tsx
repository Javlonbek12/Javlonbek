"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { ConnectUploadResult } from "@/app/(app)/connect/actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TranslationKey } from "@/lib/i18n";

// The server takes up to 20 MB per file (the request limit is 21 MB).
export const MAX_FILE_MB = 20;

// Sends the chosen exports one per request: together they may be far bigger than one request
// may carry. A file over the limit is refused here, with its name, before anything is sent.
export function ConnectUploadForm({
  action,
}: {
  action: (form: FormData) => Promise<ConnectUploadResult>;
}) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const files = [...(input.current?.files ?? [])];
    if (files.length === 0) return setError(t("connect.import.errors.empty"));
    const big = files.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (big.length > 0)
      return setError(
        t("connect.import.errors.fileTooBig", {
          names: big.map((f) => f.name).join(", "),
          mb: MAX_FILE_MB,
        }),
      );
    setError(null);
    const lines: string[] = [];
    for (const [i, file] of files.entries()) {
      setProgress({ n: i + 1, total: files.length });
      const form = new FormData();
      form.set("files", file);
      const result = await action(form).catch(() => ({ error: "failed", lines: [] }));
      if (result.error) {
        setProgress(null);
        // What was already loaded stays loaded; say which file stopped it.
        if (lines.length)
          router.push(`/connect/import?${new URLSearchParams({ done: lines.join("\n") })}`);
        return setError(
          `${file.name}: ${t(`connect.import.errors.${result.error}` as TranslationKey)}`,
        );
      }
      lines.push(...result.lines);
    }
    setProgress(null);
    if (input.current) input.current.value = "";
    router.push(`/connect/import?${new URLSearchParams({ done: lines.join("\n") })}`);
  }

  return (
    <form onSubmit={upload} className="flex flex-col gap-3">
      <Input
        ref={input}
        type="file"
        name="files"
        multiple
        required
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label={t("connect.import.files")}
        className="h-auto py-1.5"
        onChange={() => setError(null)}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={progress !== null}>
          {progress
            ? t("connect.import.progress", { n: progress.n, total: progress.total })
            : t("connect.import.submit")}
        </Button>
      </div>
    </form>
  );
}

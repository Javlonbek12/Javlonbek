"use client";

import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

// Uploads the chosen files one by one (big videos fit; progress is shown), then refreshes the page.
export function FileUpload({
  postId,
  lang,
  label,
  progressLabel,
  left,
}: {
  postId: string;
  lang: "RU" | "UZ";
  label: string;
  // "Загрузка {n} из {total}…"
  progressLabel: string;
  // How many more files fit.
  left: number;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: File[]) {
    setError(null);
    const list = files.slice(0, left);
    for (const [i, file] of list.entries()) {
      setProgress({ n: i + 1, total: list.length });
      const form = new FormData();
      form.set("file", file);
      form.set("lang", lang);
      try {
        const response = await fetch(`/api/content/posts/${postId}/files`, {
          method: "POST",
          body: form,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(`${file.name}: ${body?.error ?? response.statusText}`);
          break;
        }
      } catch {
        setError(file.name);
        break;
      }
    }
    setProgress(null);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => upload([...(e.target.files ?? [])])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={progress !== null || left <= 0}
        onClick={() => input.current?.click()}
      >
        <Paperclip />
        {progress
          ? progressLabel
              .replace("{n}", String(progress.n))
              .replace("{total}", String(progress.total))
          : label}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

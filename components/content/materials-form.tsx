"use client";

import { Check, Minus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FormAction = (form: FormData) => Promise<void>;

// The texts RU / UZ of a post with one main button, «Сохранить и отправить на проверку»: it saves
// what is typed and only then sends, so a text is never lost. Above it, what the post has
// (texts and files of each language); sending a post with something missing asks first.
// Leaving the page with an unsaved text asks too.
export function MaterialsForm({
  postId,
  textRu,
  textUz,
  files,
  save,
  submit,
  canSubmit,
}: {
  postId: string;
  textRu: string | null;
  textUz: string | null;
  // Files uploaded for each language.
  files: { RU: number; UZ: number };
  save: FormAction;
  submit: FormAction;
  canSubmit: boolean;
}) {
  const t = useT();
  const [ru, setRu] = useState(textRu ?? "");
  const [uz, setUz] = useState(textUz ?? "");
  const [asking, setAsking] = useState(false);
  const sending = useRef(false);
  const dirty = ru.trim() !== (textRu ?? "").trim() || uz.trim() !== (textUz ?? "").trim();

  // Unsaved text: closing the tab or following a link asks before the text is lost.
  useEffect(() => {
    if (!dirty) return;
    const message = t("content.materialsForm.unsaved");
    const onUnload = (e: BeforeUnloadEvent) => {
      if (sending.current) return;
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!link || sending.current || link.getAttribute("target") === "_blank") return;
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#") || link.hasAttribute("download")) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, t]);

  const parts = [
    { key: "textRu", label: t("content.materialsForm.textRu"), ok: ru.trim() !== "" },
    { key: "textUz", label: t("content.materialsForm.textUz"), ok: uz.trim() !== "" },
    { key: "filesRu", label: t("content.materialsForm.filesRu"), ok: files.RU > 0 },
    { key: "filesUz", label: t("content.materialsForm.filesUz"), ok: files.UZ > 0 },
  ];
  const missing = parts.filter((p) => !p.ok);

  return (
    <form
      action={save}
      onSubmit={() => {
        sending.current = true;
      }}
      className="flex flex-col gap-3 border-t pt-3 text-sm"
    >
      <input type="hidden" name="postId" value={postId} />
      <label className="flex flex-col gap-1">
        {t("content.fields.textRu")}
        <Textarea
          name="textRu"
          rows={6}
          maxLength={4096}
          value={ru}
          onChange={(e) => {
            sending.current = false;
            setRu(e.target.value);
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        {t("content.fields.textUz")}
        <Textarea
          name="textUz"
          rows={6}
          maxLength={4096}
          value={uz}
          onChange={(e) => {
            sending.current = false;
            setUz(e.target.value);
          }}
        />
      </label>
      {canSubmit && (
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">
            {t("content.materialsForm.readiness")}
          </span>
          <ul className="flex flex-wrap gap-1.5">
            {parts.map((p) => (
              <li
                key={p.key}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
                  p.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800"
                    : "text-muted-foreground",
                )}
              >
                {p.ok ? <Check className="size-3" /> : <Minus className="size-3" />}
                {p.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {asking && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3"
        >
          <span>
            {t("content.materialsForm.missing", {
              list: missing.map((p) => p.label).join(", "),
            })}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" formAction={submit}>
              {t("content.materialsForm.sendAnyway")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAsking(false)}>
              {t("content.materialsForm.back")}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {canSubmit &&
          !asking &&
          (missing.length ? (
            <Button type="button" onClick={() => setAsking(true)}>
              {t("content.materialsForm.saveAndSubmit")}
            </Button>
          ) : (
            <Button type="submit" formAction={submit}>
              {t("content.materialsForm.saveAndSubmit")}
            </Button>
          ))}
        <Button type="submit" variant="outline" disabled={!dirty}>
          {t("content.actions.upload")}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const snapshot = (form: HTMLFormElement | null) =>
  form
    ? new URLSearchParams([...new FormData(form)].map(([k, v]) => [k, String(v)])).toString()
    : "";

function SaveBar({ dirty, label }: { dirty: boolean; label?: string }) {
  const t = useT();
  const { pending } = useFormStatus();
  if (!dirty && !pending) return null;
  return (
    // Sticks above the menu on a phone, so it's reachable without scrolling to the end.
    <div className="bg-card/95 sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border p-2 pl-4 shadow-sm backdrop-blur md:bottom-4">
      <span className="text-muted-foreground text-sm">{t("settings.unsaved")}</span>
      <Button type="submit" className="ml-auto">
        {label ?? t("common.save")}
      </Button>
    </div>
  );
}

// A form whose «Сохранить» appears only after something changed (and goes when it is changed
// back), with «Есть несохранённые изменения» next to it.
export function DirtyForm({
  action,
  children,
  className,
  saveLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
  saveLabel?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const saved = useRef("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    saved.current = snapshot(ref.current);
  }, []);
  const check = () => setDirty(snapshot(ref.current) !== saved.current);
  return (
    <form
      ref={ref}
      action={action}
      onInput={check}
      onChange={check}
      onSubmit={() => {
        saved.current = snapshot(ref.current);
        setDirty(false);
      }}
      className={cn("flex flex-col gap-4", className)}
    >
      {children}
      <SaveBar dirty={dirty} label={saveLabel} />
    </form>
  );
}

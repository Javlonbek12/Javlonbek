"use client";

import { useRef } from "react";

import { useT } from "@/components/locale-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Quiet hours are both times or none: half-filled, the browser stops the save and says why.
export function QuietHours({ from, to }: { from: string; to: string }) {
  const t = useT();
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const check = () => {
    const a = fromRef.current;
    const b = toRef.current;
    if (!a || !b) return;
    const half = (a.value === "") !== (b.value === "");
    const message = half ? t("settings.quietHalf") : "";
    (a.value === "" ? a : b).setCustomValidity(message);
    (a.value === "" ? b : a).setCustomValidity("");
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Label>
        {t("settings.quietFrom")}
        <Input
          ref={fromRef}
          type="time"
          name="quietFrom"
          className="w-28"
          defaultValue={from}
          onInput={check}
        />
      </Label>
      <Label>
        {t("settings.quietTo")}
        <Input
          ref={toRef}
          type="time"
          name="quietTo"
          className="w-28"
          defaultValue={to}
          onInput={check}
        />
      </Label>
    </div>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useT();
  const forbidden = error.name === "ForbiddenError" || error.message === "Forbidden";
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert">{forbidden ? t("errors.forbidden") : t("errors.generic")}</p>
      <Button variant="outline" onClick={reset}>
        OK
      </Button>
    </div>
  );
}

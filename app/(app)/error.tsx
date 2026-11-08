"use client";

import { House, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/components/locale-provider";

// A page that failed: what happened, try again, or back to «Сегодня» (never a dead end).
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useT();
  const forbidden = error.name === "ForbiddenError" || error.message === "Forbidden";
  return (
    <Card role="alert" className="mx-auto mt-6 max-w-md items-start">
      <span className="bg-destructive/10 text-destructive flex size-10 items-center justify-center rounded-full">
        <TriangleAlert className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl">{t("errors.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {forbidden ? t("errors.forbidden") : t("errors.generic")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/">
            <House />
            {t("errors.backHome")}
          </Link>
        </Button>
        {!forbidden && (
          <Button variant="outline" onClick={reset}>
            <RotateCcw />
            {t("errors.retry")}
          </Button>
        )}
      </div>
    </Card>
  );
}

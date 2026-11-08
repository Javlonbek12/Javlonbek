"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

// «Обновить»: the page's numbers again, without leaving it.
export function RefreshButton() {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {t("settings.server.refresh")}
    </Button>
  );
}

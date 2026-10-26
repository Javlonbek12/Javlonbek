"use client";

import { Printer } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  const t = useT();
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer />
      {t("dist.waybill.print")}
    </Button>
  );
}

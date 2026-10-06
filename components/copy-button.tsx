"use client";

import { Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Copy />
      {copied ? t("common.copied") : (label ?? t("common.copy"))}
    </Button>
  );
}

"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

// Copies a document with its formatting (tables stay tables when pasted into the EAS editor or
// Word); plain text where the browser can't copy HTML.
export function CopyHtmlButton({ html, text }: { html: string; text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <Button type="button" size="sm" onClick={copy}>
      {done ? <Check /> : <Copy />}
      {done ? t("dist.eas.copied") : t("dist.eas.copy")}
    </Button>
  );
}

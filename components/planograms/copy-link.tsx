"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

// Copies the merchandisers' link in one press.
export function CopyLinkButton({ url }: { url: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <Button type="button" size="sm" onClick={copy}>
      {done ? <Check /> : <Copy />}
      {done ? t("planograms.actions.copied") : t("planograms.actions.copyLink")}
    </Button>
  );
}

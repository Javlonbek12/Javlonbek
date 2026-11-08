"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

// «Поделиться»: on a phone the system share sheet (Telegram in two taps); elsewhere the ready
// message (instruction and link) is copied to paste into a chat.
export function ShareButton({
  text,
  variant = "default",
}: {
  text: string;
  variant?: "default" | "outline";
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      onClick={async () => {
        if (typeof navigator.share === "function") {
          try {
            await navigator.share({ text });
            return;
          } catch (error) {
            // Closed by the person: nothing to do. Anything else: fall back to copying.
            if (error instanceof DOMException && error.name === "AbortError") return;
          }
        }
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Share2 />
      {copied ? t("team.shareCopied") : t("team.share")}
    </Button>
  );
}

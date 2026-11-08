"use client";

import { MessageCircleQuestionMark } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

import { HelpPanel, type AskHelp } from "./help-panel";

// The round header button that opens the help sheet. The sheet lives in <body>: the phone header
// is sticky and blurred, which would trap a fixed sheet inside it and under the bottom bar. Once
// opened it stays mounted, so the conversation survives closing it and moving between pages.
export function HelpLauncher({ ask, className }: { ask: AskHelp; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStarted(true);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("help.button")}
        title={t("help.button")}
        className={cn(
          "bg-card hover:bg-accent text-muted-foreground hover:text-foreground flex size-10 items-center justify-center rounded-full border",
          open && "text-primary",
          className,
        )}
      >
        <MessageCircleQuestionMark className="size-[18px]" />
      </button>
      {started &&
        createPortal(
          <HelpPanel open={open} onClose={() => setOpen(false)} ask={ask} />,
          document.body,
        )}
    </>
  );
}

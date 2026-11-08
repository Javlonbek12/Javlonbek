"use client";

import {
  ArrowRight,
  Loader2,
  MessageCircleQuestionMark,
  RotateCcw,
  SendHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import type { HelpResult } from "@/app/(app)/help-actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import type { TranslationKey } from "@/lib/i18n";
import {
  helpSectionOf,
  HISTORY_TURNS,
  MAX_QUESTION,
  type HelpTurn,
} from "@/modules/ai/help-shared";

import { HelpText } from "./help-text";

export type AskHelp = (input: {
  question: string;
  history: HelpTurn[];
  path: string;
}) => Promise<HelpResult>;

type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; links: { href: string; label: string }[] }
  | { role: "error"; text: string };

// The md breakpoint, where the bottom sheet becomes a side panel.
const isPhone = () => window.matchMedia?.("(max-width: 767px)").matches ?? false;

// The help sheet: a side panel on a computer (the page stays usable), a bottom sheet on a phone.
// The conversation lives here while the app is open; the last few turns go with each question.
export function HelpPanel({
  open,
  onClose,
  ask,
}: {
  open: boolean;
  onClose: () => void;
  ask: AskHelp;
}) {
  const t = useT();
  const pathname = usePathname();
  const titleId = useId();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // On a computer the cursor waits in the box; on a phone the keyboard would hide the suggestions.
  useEffect(() => {
    if (open && !isPhone()) input.current?.focus();
  }, [open]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [turns, pending]);

  const section = helpSectionOf(pathname)?.id ?? "default";
  const suggestions = (["q1", "q2", "q3"] as const).map((q) =>
    t(`help.suggest.${section}.${q}` as TranslationKey),
  );

  const send = (text: string) => {
    const asked = text.trim();
    if (!asked || pending) return;
    const history = turns
      .filter((turn) => turn.role !== "error")
      .slice(-HISTORY_TURNS)
      .map((turn) => ({ role: turn.role as HelpTurn["role"], text: turn.text }));
    setTurns((all) => [...all, { role: "user", text: asked }]);
    setQuestion("");
    startTransition(async () => {
      const result = await ask({ question: asked, history, path: pathname });
      setTurns((all) => [
        ...all,
        result.ok
          ? { role: "assistant", text: result.answer, links: result.links }
          : { role: "error", text: t(result.error) },
      ]);
    });
  };

  // A link on a phone leaves the sheet so the page shows; on a computer the steps stay beside it.
  const followLink = () => {
    if (isPhone()) onClose();
  };

  return (
    <div
      hidden={!open}
      className="fixed inset-0 z-50 md:pointer-events-none"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <button
        type="button"
        aria-label={t("help.close")}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/30 md:hidden"
      />
      <section
        role="dialog"
        aria-labelledby={titleId}
        className="bg-card absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t shadow-2xl md:pointer-events-auto md:inset-y-3 md:right-3 md:left-auto md:max-h-none md:w-[26rem] md:rounded-2xl md:border"
      >
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <MessageCircleQuestionMark className="text-primary size-5" />
          <h2 id={titleId} className="font-semibold">
            {t("help.title")}
          </h2>
          <span className="ml-auto flex items-center gap-1">
            {turns.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTurns([])}
                disabled={pending}
              >
                <RotateCcw />
                {t("help.clear")}
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("help.close")}
              className="text-muted-foreground hover:bg-accent rounded-full p-1.5"
            >
              <X className="size-5" />
            </button>
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-3 text-sm">
          {turns.length === 0 && (
            <>
              <p className="text-muted-foreground">{t("help.intro")}</p>
              <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {t("help.suggested")}
              </span>
              <ul className="flex flex-col gap-1.5">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => send(s)}
                      disabled={pending}
                      className="hover:bg-accent w-full rounded-xl border px-3 py-2 text-left"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <p
                key={i}
                aria-label={t("help.you")}
                className="bg-primary text-primary-foreground ml-8 self-end rounded-2xl rounded-br-md px-3 py-2 whitespace-pre-wrap"
              >
                {turn.text}
              </p>
            ) : turn.role === "error" ? (
              <p
                key={i}
                role="alert"
                className="bg-destructive/10 text-destructive mr-8 rounded-2xl px-3 py-2"
              >
                {turn.text}
              </p>
            ) : (
              <div
                key={i}
                aria-label={t("help.assistant")}
                className="bg-muted mr-8 flex flex-col gap-2 rounded-2xl rounded-bl-md px-3 py-2"
              >
                <HelpText text={turn.text} links={turn.links} onLink={followLink} />
                {turn.links.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {turn.links.map((link) => (
                      <Button key={link.href} asChild variant="outline" size="sm">
                        <Link href={link.href} onClick={followLink} title={t("help.openPage")}>
                          {link.label}
                          <ArrowRight />
                        </Link>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {pending && (
            <p role="status" className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              {t("help.pending")}
            </p>
          )}
          <div ref={end} />
        </div>

        <form
          className="flex flex-col gap-2 border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            send(question);
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={input}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                // Enter asks; Shift+Enter starts a new line.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(question);
                }
              }}
              rows={2}
              maxLength={MAX_QUESTION}
              placeholder={t("help.placeholder")}
              aria-label={t("help.placeholder")}
              className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 min-h-11 flex-1 resize-none rounded-xl border px-3 py-2 text-base outline-none focus-visible:ring-[3px] md:text-sm"
            />
            <Button
              type="submit"
              size="icon"
              disabled={pending || !question.trim()}
              aria-label={t("help.send")}
              title={t("help.send")}
            >
              {pending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{t("help.note")}</p>
        </form>
      </section>
    </div>
  );
}

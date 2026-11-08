import { Check } from "lucide-react";
import Link from "next/link";

import { quickCloseAction } from "@/app/(app)/tasks/actions";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// The round button before a task's title: the next allowed step towards closing it (a personal
// task is done; the assignee hands it in; whoever accepts the result accepts it). A short word
// under it says what a press does («Готово», «Сдать», «Принять») — a phone has no tooltip.
// Someone else's work is never accepted from a list unseen: there the circle opens the card
// (`openHref`), where «Что сдано» and the decision buttons are. Without a step it is only a mark:
// filled for a closed task, faint otherwise.
export function QuickCircle({
  taskId,
  status,
  target,
  accepts,
  blocked,
  back,
  openHref,
  size = "md",
}: {
  taskId: string;
  status: TaskStatus;
  target: "DONE" | "IN_REVIEW" | null;
  // The actor accepts someone else's work (the label says «Принять»).
  accepts: boolean;
  // Open blocking tasks: closing has to wait.
  blocked: boolean;
  back: string;
  // In a list: where the task's card opens (accepting happens there).
  openHref?: string;
  size?: "md" | "lg";
}) {
  const box = size === "lg" ? "size-7" : "size-6";
  if (status === "DONE" || status === "CANCELLED")
    return (
      <span
        title={t("tasks.panel.quick.closed")}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          box,
          status === "DONE"
            ? "bg-emerald-500 text-white"
            : "border-muted-foreground/30 border-2 border-dashed",
        )}
      >
        {status === "DONE" && <Check className="size-3.5" strokeWidth={3} />}
      </span>
    );
  if (!target || blocked)
    return (
      <span
        title={blocked ? t("tasks.panel.quick.blocked") : t("tasks.panel.quick.none")}
        className={cn("border-muted-foreground/25 block shrink-0 rounded-full border-2", box)}
      />
    );
  const label =
    target === "IN_REVIEW"
      ? t("tasks.panel.quick.IN_REVIEW")
      : accepts
        ? t("tasks.panel.quick.accept")
        : t("tasks.panel.quick.DONE");
  const word =
    target === "IN_REVIEW"
      ? t("tasks.panel.quick.handInShort")
      : accepts
        ? t("tasks.panel.quick.acceptShort")
        : t("tasks.panel.quick.doneShort");
  const circle = cn(
    "group border-muted-foreground/50 hover:border-primary hover:bg-primary/10 focus-visible:ring-ring flex items-center justify-center rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:outline-none",
    box,
  );
  const mark = (
    <Check
      className="text-primary size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
      strokeWidth={3}
    />
  );
  const caption = (
    <span className="text-muted-foreground text-[10px] leading-none font-medium">{word}</span>
  );
  if (accepts && openHref)
    return (
      <Link
        href={openHref}
        scroll={false}
        title={t("tasks.panel.quick.openToAccept")}
        aria-label={t("tasks.panel.quick.openToAccept")}
        className="flex shrink-0 flex-col items-center gap-1"
      >
        <span className={circle}>{mark}</span>
        {caption}
      </Link>
    );
  return (
    <form action={quickCloseAction} className="flex shrink-0">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="back" value={back} />
      <button
        type="submit"
        title={label}
        aria-label={label}
        className="flex flex-col items-center gap-1"
      >
        <span className={circle}>{mark}</span>
        {caption}
      </button>
    </form>
  );
}

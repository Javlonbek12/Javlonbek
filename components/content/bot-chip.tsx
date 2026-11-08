import type { ContentChannel, ContentStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Each bot has its colour everywhere in the content plan.
export const BOT_COLOR: Record<ContentChannel, string> = {
  PARTNER: "var(--series-2)",
  CONNECT: "var(--series-1)",
  RESEARCH: "var(--series-7)",
};

export function BotChip({
  channel,
  sent,
  className,
}: {
  channel: ContentChannel;
  sent?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <span className="size-2 rounded-full" style={{ background: BOT_COLOR[channel] }} />
      {t(`content.channels.${channel}`)}
      {sent && <span aria-label={t("content.sent")}>✓</span>}
    </span>
  );
}

const STATUS_STYLE: Record<ContentStatus, string> = {
  PLANNED: "bg-muted text-muted-foreground",
  DRAFT: "bg-blue-500/12 text-blue-700",
  REVIEW: "bg-amber-500/15 text-amber-700",
  LEGAL_REVIEW: "bg-violet-500/15 text-violet-700",
  // Not red: red is kept for late posts and errors.
  CHANGES: "bg-orange-500/15 text-orange-700",
  APPROVED: "bg-emerald-500/15 text-emerald-700",
  SENT: "bg-emerald-600 text-white",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_STYLE[status],
      )}
    >
      {t(`content.status.${status}`)}
    </span>
  );
}

// The publication day has passed and the post wasn't sent: the only red mark in the plan.
export function LateBadge({ compact }: { compact?: boolean }) {
  return compact ? (
    <span
      className="bg-destructive flex size-3.5 shrink-0 items-center justify-center rounded-full text-[9px] leading-none font-bold text-white"
      title={t("content.late.badge")}
      aria-label={t("content.late.badge")}
    >
      !
    </span>
  ) : (
    <span className="bg-destructive/12 text-destructive inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap">
      <span aria-hidden>!</span>
      {t("content.late.badge")}
    </span>
  );
}

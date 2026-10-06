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
  CHANGES: "bg-destructive/12 text-destructive",
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

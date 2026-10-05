import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Done share as a filled bar; the tick shows where the plan says we should be today.
export function ProgressBar({
  percent,
  planned,
  late,
  className,
}: {
  percent: number;
  planned?: number;
  late?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("bg-muted relative h-2.5 w-full rounded-full", className)}>
      <div
        className={cn("h-full rounded-full", late ? "bg-destructive" : "bg-emerald-500")}
        style={{ width: `${percent}%` }}
      />
      {planned !== undefined && planned > 0 && (
        <div
          className="bg-foreground absolute -top-1 -bottom-1 w-0.5 rounded"
          style={{ left: `calc(${planned}% - 1px)` }}
          title={t("projects.plannedMark")}
        />
      )}
    </div>
  );
}

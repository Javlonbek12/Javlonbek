import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("bg-secondary h-2 w-full overflow-hidden rounded-full", className)}
    >
      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${value}%` }} />
    </div>
  );
}

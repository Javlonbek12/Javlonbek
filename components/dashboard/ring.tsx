import { cn } from "@/lib/utils";

// A progress ring: an arc in the given colour around a filled centre with the value.
export function Ring({
  percent,
  color,
  size = 96,
  label,
  filled = true,
  className,
  title,
}: {
  percent: number;
  // A CSS colour, e.g. "var(--series-1)".
  color: string;
  size?: number;
  // Text in the centre; the percent by default.
  label?: string;
  // Dark filled centre (portfolio style) or an empty one.
  filled?: boolean;
  className?: string;
  title?: string;
}) {
  const r = 42;
  const length = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, percent));
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={title ?? `${value}%`}
    >
      {title && <title>{title}</title>}
      <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
      {value > 0 && (
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          stroke={color}
          strokeDasharray={`${(length * value) / 100} ${length}`}
          transform="rotate(-90 50 50)"
        />
      )}
      {filled && <circle cx="50" cy="50" r="33" className="fill-foreground/85" />}
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        className={cn("text-[19px] font-semibold", filled ? "fill-background" : "fill-foreground")}
      >
        {label ?? `${value}%`}
      </text>
    </svg>
  );
}

// A small stat with a ring: "12/15 · Tasks done".
export function StatRing({
  value,
  total,
  color,
  caption,
}: {
  value: number;
  total: number;
  color: string;
  caption: string;
}) {
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border p-3">
      <Ring
        percent={total ? Math.round((value / total) * 100) : 0}
        color={color}
        size={52}
        filled={false}
        label=""
      />
      <div className="flex min-w-0 flex-col">
        <span className="text-muted-foreground truncate text-xs">{caption}</span>
        <span className="text-xl font-semibold">
          {value}
          <span className="text-muted-foreground text-sm font-normal">/{total}</span>
        </span>
      </div>
    </div>
  );
}

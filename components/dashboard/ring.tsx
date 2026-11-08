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
        className={cn(
          "font-display text-[17px] font-semibold",
          filled ? "fill-background" : "fill-foreground",
        )}
      >
        {label ?? `${value}%`}
      </text>
    </svg>
  );
}

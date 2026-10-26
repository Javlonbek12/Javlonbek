import { MAP_HEIGHT, MAP_WIDTH, PROVINCES, REGION_POINTS } from "./uz-map-data";

// Uzbekistan by region, coloured by a number (one hue, lighter = less), with the number on each
// region; a region links to its page. Kokand is a sales region inside the Fergana province, so it
// is a circle at the city. Plain SVG: rendered on the server.
export function UzbekistanMap({
  values,
  format,
  href,
  selected,
}: {
  values: Record<string, number>;
  format: (n: number) => string;
  href?: (region: string) => string;
  selected?: string;
}) {
  const max = Math.max(1, ...Object.values(values));
  const opacity = (n: number | undefined) => (n ? 0.12 + 0.78 * (n / max) : 0.04);
  const labels = new Map<string, [number, number]>();
  for (const p of PROVINCES) if (!labels.has(p.region)) labels.set(p.region, [p.cx, p.cy]);
  const city = REGION_POINTS.Tashkent!;
  labels.set("Tashkent", [city[0] - 40, city[1] - 30]);
  const kokand = REGION_POINTS.Kokand!;
  const link = (region: string, child: React.ReactNode, key: string) =>
    href ? (
      <a key={key} href={href(region)} aria-label={`${region}: ${format(values[region] ?? 0)}`}>
        {child}
      </a>
    ) : (
      <g key={key}>{child}</g>
    );
  // Short labels: the map is small on a phone.
  const short = (region: string) => (region === "Karakalpakistan" ? "Karakalpak." : region);

  return (
    <svg
      viewBox={`-10 -10 ${MAP_WIDTH + 20} ${MAP_HEIGHT + 20}`}
      className="h-auto w-full"
      role="img"
      aria-label="Uzbekistan"
    >
      {PROVINCES.map((p) =>
        link(
          p.region,
          <path
            d={p.d}
            fill="#2a78d6"
            fillOpacity={opacity(values[p.region])}
            className="stroke-card hover:stroke-foreground cursor-pointer transition-[fill-opacity]"
            strokeWidth={selected === p.region ? 3 : 1.5}
            stroke={selected === p.region ? "#1f5fae" : undefined}
          >
            <title>{`${p.region}: ${format(values[p.region] ?? 0)}`}</title>
          </path>,
          p.iso,
        ),
      )}
      {values.Kokand !== undefined &&
        link(
          "Kokand",
          <circle
            cx={kokand[0]}
            cy={kokand[1]}
            r={12 + 14 * ((values.Kokand ?? 0) / max)}
            fill="#2a78d6"
            fillOpacity={0.85}
            className="stroke-card cursor-pointer"
            strokeWidth={2}
          >
            <title>{`Kokand: ${format(values.Kokand ?? 0)}`}</title>
          </circle>,
          "kokand",
        )}
      {[...labels].map(([region, [x, y]]) => (
        // A halo in the card's colour keeps the text readable on any shade.
        <g
          key={region}
          className="pointer-events-none"
          textAnchor="middle"
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          <text
            x={x}
            y={y - 4}
            fontSize={22}
            fontWeight={700}
            className="fill-foreground stroke-card"
            strokeWidth={5}
          >
            {format(values[region] ?? 0)}
          </text>
          <text
            x={x}
            y={y + 15}
            fontSize={14}
            className="fill-muted-foreground stroke-card"
            strokeWidth={4}
          >
            {short(region)}
          </text>
        </g>
      ))}
      {values.Kokand !== undefined && (
        <g className="pointer-events-none" textAnchor="middle" paintOrder="stroke">
          <text
            x={kokand[0]}
            y={kokand[1] + 44}
            fontSize={14}
            className="fill-foreground stroke-card"
            strokeWidth={4}
            fontWeight={600}
          >
            Kokand {format(values.Kokand ?? 0)}
          </text>
        </g>
      )}
    </svg>
  );
}

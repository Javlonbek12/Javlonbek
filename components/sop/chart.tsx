import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cases, monthLabel } from "@/modules/sop/texts";

// The picture of a sheet or of one SKU by month: sales and shipments on top (columns and a line),
// stocks below (lines) — two panels over one row of months, each with its own axis, because the
// two are different things on different scales. The forecast part is paler and dashed, with a
// tinted ground. Server-drawn SVG: a month's numbers are in its hover title and in the table
// under the chart.

export type ChartMonth = {
  month: string;
  forecast: boolean;
  sellIn: number;
  sellThru: number;
  out: number;
  entity: number;
  dist: number;
};

const WIDTH = 760;
const LEFT = 46;
const RIGHT = 8;
const FLOWS = { top: 18, height: 150 };
const STOCKS = { top: 206, height: 110 };
const HEIGHT = 340;

// The project's identity colours in their fixed order (app/globals.css).
const COLOR = {
  sellIn: "var(--series-1)",
  sellThru: "var(--series-2)",
  out: "var(--series-3)",
  entity: "var(--series-4)",
  dist: "var(--series-5)",
} as const;

// A round top for an axis and its ticks: 1, 2 or 5 times a power of ten.
function axis(max: number) {
  const rough = Math.max(max, 1) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough)!;
  const ticks = [];
  for (let tick = 0; tick <= Math.max(max, 1) + step * 0.001; tick += step) ticks.push(tick);
  if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
  return { top: ticks.at(-1)!, ticks };
}

export function PsiChart({ months, title }: { months: ChartMonth[]; title: string }) {
  if (months.length === 0) return null;
  const slot = (WIDTH - LEFT - RIGHT) / months.length;
  const center = (i: number) => LEFT + slot * (i + 0.5);
  const flowAxis = axis(Math.max(...months.flatMap((m) => [m.sellIn, m.sellThru, m.out])));
  const stockAxis = axis(Math.max(...months.flatMap((m) => [m.entity, m.dist])));
  const flowY = (v: number) =>
    FLOWS.top + FLOWS.height - (Math.max(v, 0) / flowAxis.top) * FLOWS.height;
  const stockY = (v: number) =>
    STOCKS.top + STOCKS.height - (Math.max(v, 0) / stockAxis.top) * STOCKS.height;
  const firstForecast = months.findIndex((m) => m.forecast);
  const bar = Math.max(3, Math.min(13, slot / 2 - 3));

  // A line in two strokes: solid over the closed months, dashed over the forecast (the dashed
  // part starts at the last closed month so the line does not break).
  const line = (
    key: keyof typeof COLOR,
    y: (v: number) => number,
    value: (m: ChartMonth) => number,
  ) => {
    const point = (m: ChartMonth, i: number) => `${center(i)},${y(value(m))}`;
    const split = firstForecast < 0 ? months.length : firstForecast;
    const solid = months.slice(0, split).map(point);
    const dashed = months
      .map((m, i) => ({ m, i }))
      .filter(({ i }) => i >= Math.max(0, split - 1))
      .map(({ m, i }) => point(m, i));
    return (
      <g key={key} fill="none" stroke={COLOR[key]} strokeWidth={2} strokeLinejoin="round">
        {solid.length > 1 && <polyline points={solid.join(" ")} />}
        {dashed.length > 1 && split < months.length && (
          <polyline points={dashed.join(" ")} strokeDasharray="5 4" />
        )}
        {months.map((m, i) => (
          <circle
            key={m.month}
            cx={center(i)}
            cy={y(value(m))}
            r={2.5}
            fill={m.forecast ? "var(--card)" : COLOR[key]}
            strokeWidth={1.5}
          />
        ))}
      </g>
    );
  };

  const panel = (
    top: number,
    height: number,
    scale: ReturnType<typeof axis>,
    y: (v: number) => number,
    label: string,
  ) => (
    <g>
      <text x={LEFT} y={top - 7} fontSize={10} fill="currentColor">
        {label}
      </text>
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={y(tick)}
            y2={y(tick)}
            stroke="currentColor"
            strokeOpacity={tick === 0 ? 0.35 : 0.12}
          />
          <text x={LEFT - 5} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="currentColor">
            {formatNumber(tick, 0)}
          </text>
        </g>
      ))}
      {firstForecast >= 0 && (
        <rect
          x={LEFT + slot * firstForecast}
          y={top}
          width={slot * (months.length - firstForecast)}
          height={height}
          fill="currentColor"
          fillOpacity={0.05}
        />
      )}
    </g>
  );

  const legend = [
    ["sellIn", "bar"],
    ["sellThru", "bar"],
    ["out", "line"],
    ["entity", "line"],
    ["dist", "line"],
  ] as const;

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={title}
          className="text-muted-foreground h-auto w-full min-w-[620px]"
        >
          {panel(FLOWS.top, FLOWS.height, flowAxis, flowY, t("sop.overview.chart.flows"))}
          {panel(STOCKS.top, STOCKS.height, stockAxis, stockY, t("sop.overview.chart.stocks"))}
          {firstForecast >= 0 && (
            <text
              x={LEFT + slot * firstForecast + 5}
              y={FLOWS.top + 11}
              fontSize={9}
              fill="currentColor"
            >
              {t("sop.overview.chart.forecast")}
            </text>
          )}
          {months.map((m, i) => (
            <g key={m.month} fillOpacity={m.forecast ? 0.45 : 1}>
              {(["sellIn", "sellThru"] as const).map((key, k) => {
                const y = flowY(m[key]);
                const height = FLOWS.top + FLOWS.height - y;
                return (
                  <rect
                    key={key}
                    x={center(i) + (k === 0 ? -bar - 1 : 1)}
                    y={y}
                    width={bar}
                    height={height}
                    rx={Math.min(2, height / 2)}
                    fill={COLOR[key]}
                  />
                );
              })}
            </g>
          ))}
          {line("out", flowY, (m) => m.out)}
          {line("entity", stockY, (m) => m.entity)}
          {line("dist", stockY, (m) => m.dist)}
          {months.map((m, i) => (
            <g key={m.month}>
              <text
                x={center(i)}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={9}
                fill="currentColor"
                fontWeight={m.forecast ? 400 : 500}
              >
                {monthLabel(m.month)}
              </text>
              {/* The month's numbers on hover: the whole column of both panels is the target. */}
              <rect x={LEFT + slot * i} y={0} width={slot} height={HEIGHT} fill="transparent">
                <title>
                  {[
                    `${monthLabel(m.month)}${m.forecast ? ` · ${t("sop.overview.chart.forecast")}` : ""}`,
                    ...legend.map(([key]) => `${t(`sop.overview.chart.${key}`)}: ${cases(m[key])}`),
                  ].join("\n")}
                </title>
              </rect>
            </g>
          ))}
        </svg>
      </div>
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {legend.map(([key, kind]) => (
          <li key={key} className="flex items-center gap-1.5">
            <span
              className={kind === "bar" ? "size-2.5 rounded-sm" : "h-0.5 w-4 rounded-full"}
              style={{ background: COLOR[key] }}
            />
            {t(`sop.overview.chart.${key}`)}
          </li>
        ))}
      </ul>
      <details className="text-sm">
        <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs underline underline-offset-2">
          {t("sop.overview.chart.table")}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left font-normal">{t("sop.overview.chart.month")}</th>
                {legend.map(([key]) => (
                  <th key={key} className="px-2 py-1 text-right font-normal">
                    {t(`sop.overview.chart.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t">
                  <td className="px-2 py-1 whitespace-nowrap">
                    {monthLabel(m.month)}
                    {m.forecast && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {t("sop.overview.chart.forecast")}
                      </span>
                    )}
                  </td>
                  {legend.map(([key]) => (
                    <td key={key} className="px-2 py-1 text-right tabular-nums">
                      {cases(m[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

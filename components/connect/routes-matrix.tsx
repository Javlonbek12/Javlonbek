import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { MATRIX_CLASSES, type MatrixClass, type RouteAnalysis } from "@/modules/connect/routes";

// Both targets reached is good, one missed a warning, both missed a real problem.
export const CLASS_COLOR: Record<MatrixClass, string> = {
  ok: "#1f9d55",
  one: "#d69e2e",
  both: "#dc2626",
};

const WIDTH = 360;
const HEIGHT = 250;
const PAD = { left: 34, right: 10, top: 10, bottom: 30 };

// «Visit × Hitting»: a DR zone is a point, attendance across and hit rate up; the targets are
// solid lines and the averages dashed ones. Plain SVG, sized by its container.
export function RoutesMatrix({
  zones,
  average,
  targets,
}: {
  // The owner's targets: the solid lines.
  targets: RouteAnalysis["targets"];
  zones: RouteAnalysis["zones"];
  average: NonNullable<RouteAnalysis["matrix"]>["average"];
}) {
  const points = zones.filter(
    (z): z is typeof z & { attendance: number; hitRate: number; class: MatrixClass } =>
      z.class !== null && z.attendance !== null && z.hitRate !== null,
  );
  // Attendance is mostly close to 100%: the axis starts at the lowest ten below every point.
  const lowest = Math.min(targets.attendance, ...points.map((p) => p.attendance));
  const from = Math.max(0, Math.floor(lowest / 10) * 10 - (lowest % 10 === 0 ? 10 : 0));
  const x = (value: number) =>
    PAD.left + ((value - from) / (100 - from)) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number) =>
    HEIGHT - PAD.bottom - (value / 100) * (HEIGHT - PAD.top - PAD.bottom);
  const step = 100 - from > 50 ? 20 : 10;
  const xTicks = Array.from(
    { length: Math.floor((100 - from) / step) + 1 },
    (_, i) => from + i * step,
  );
  const yTicks = [0, 25, 50, 75, 100];
  const percent = (value: number) => `${formatNumber(value)}%`;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t("connect.routes.matrix.title")}
        className="text-muted-foreground h-auto w-full max-w-xl"
      >
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="currentColor"
              strokeOpacity={0.15}
            />
            <text
              x={PAD.left - 5}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
            >
              {tick}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text
            key={`x${tick}`}
            x={x(tick)}
            y={HEIGHT - PAD.bottom + 12}
            textAnchor="middle"
            fontSize={9}
            fill="currentColor"
          >
            {tick}
          </text>
        ))}
        <text
          x={(PAD.left + WIDTH - PAD.right) / 2}
          y={HEIGHT - 4}
          textAnchor="middle"
          fontSize={9}
          fill="currentColor"
        >
          {t("connect.routes.matrix.axisAttendance")}
        </text>
        <text
          x={9}
          y={(PAD.top + HEIGHT - PAD.bottom) / 2}
          textAnchor="middle"
          fontSize={9}
          fill="currentColor"
          transform={`rotate(-90 9 ${(PAD.top + HEIGHT - PAD.bottom) / 2})`}
        >
          {t("connect.routes.matrix.axisHitRate")}
        </text>
        {/* The four corners: both targets reached (top right), one missed, both missed. */}
        {(
          [
            ["ok", x(targets.attendance), PAD.top, WIDTH - PAD.right, y(targets.hitRate)],
            ["both", PAD.left, y(targets.hitRate), x(targets.attendance), HEIGHT - PAD.bottom],
            ["one", PAD.left, PAD.top, x(targets.attendance), y(targets.hitRate)],
            [
              "one",
              x(targets.attendance),
              y(targets.hitRate),
              WIDTH - PAD.right,
              HEIGHT - PAD.bottom,
            ],
          ] as const
        ).map(([kind, x1, y1, x2, y2], i) => (
          <rect
            key={i}
            x={Math.min(x1, x2)}
            y={Math.min(y1, y2)}
            width={Math.abs(x2 - x1)}
            height={Math.abs(y2 - y1)}
            fill={CLASS_COLOR[kind]}
            fillOpacity={0.07}
          />
        ))}
        {/* The targets. */}
        <line
          x1={x(targets.attendance)}
          x2={x(targets.attendance)}
          y1={PAD.top}
          y2={HEIGHT - PAD.bottom}
          stroke="currentColor"
          strokeOpacity={0.7}
        />
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(targets.hitRate)}
          y2={y(targets.hitRate)}
          stroke="currentColor"
          strokeOpacity={0.7}
        />
        {/* The averages. */}
        {average.attendance !== null && average.attendance >= from && (
          <line
            x1={x(average.attendance)}
            x2={x(average.attendance)}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            stroke="#2a78d6"
            strokeDasharray="4 3"
          />
        )}
        {average.hitRate !== null && (
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(average.hitRate)}
            y2={y(average.hitRate)}
            stroke="#2a78d6"
            strokeDasharray="4 3"
          />
        )}
        {points.map((p) => (
          <circle
            key={p.zone}
            cx={x(p.attendance)}
            cy={y(p.hitRate)}
            r={4}
            fill={CLASS_COLOR[p.class]}
            fillOpacity={0.75}
            stroke={CLASS_COLOR[p.class]}
          >
            <title>
              {`${p.zone}${p.person ? ` · ${p.person}` : ""}: ${t("connect.routes.col.attendance")} ${percent(p.attendance)}, ${t("connect.routes.col.hitRate")} ${percent(p.hitRate)}`}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption>
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {MATRIX_CLASSES.map((c) => (
            <li key={c} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: CLASS_COLOR[c] }} />
              {t(`connect.routes.class.${c}`)}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="h-px w-4 bg-current" />
            {t("connect.routes.matrix.targets", {
              attendance: targets.attendance,
              hitRate: targets.hitRate,
            })}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="w-4 border-t border-dashed border-[#2a78d6]" />
            {t("connect.routes.matrix.averages", {
              attendance: average.attendance === null ? "—" : percent(average.attendance),
              hitRate: average.hitRate === null ? "—" : percent(average.hitRate),
            })}
          </li>
        </ul>
      </figcaption>
    </figure>
  );
}

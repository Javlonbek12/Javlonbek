import { t } from "@/lib/i18n";
import { PROFILE_AXES, type ProfileAxis, type Scores } from "@/modules/team/profile";

// Radar ("pentagon") chart: the employee's five scores against the team average.
// Two series → legend; colors are dataviz palette slots 1–2, validated for light and dark
// (light #2a78d6 / #eb6834 on #fcfcfb; dark #3987e5 / #d95926 on #1a1a19). The team average is
// also dashed, so it differs by more than color. A table repeats the numbers.
const SIZE = 300;
const C = SIZE / 2;
const R = 100;

function point(axis: number, value: number) {
  const angle = -Math.PI / 2 + (axis * 2 * Math.PI) / PROFILE_AXES.length;
  return [
    C + Math.cos(angle) * R * (value / 100),
    C + Math.sin(angle) * R * (value / 100),
  ] as const;
}

const polygon = (scores: Scores) =>
  PROFILE_AXES.map((axis, i) => point(i, scores[axis] ?? 0).join(",")).join(" ");

export function ProfileRadar({
  person,
  team,
  name,
}: {
  person: Scores;
  team: Scores;
  name: string;
}) {
  const value = (v: number | null) => (v === null ? t("team.profile360.noData") : String(v));
  return (
    <figure className="flex flex-col gap-2">
      <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-[#2a78d6] dark:bg-[#3987e5]" />
          {name}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-[#eb6834] dark:border-[#d95926]" />
          {t("team.profile360.teamAverage")}
        </span>
      </div>
      <svg
        viewBox={`-80 -10 ${SIZE + 160} ${SIZE + 20}`}
        className="mx-auto w-full max-w-md"
        role="img"
        aria-label={t("team.profile360.title")}
      >
        {/* Recessive rings and spokes. */}
        {[25, 50, 75, 100].map((ring) => (
          <polygon
            key={ring}
            points={PROFILE_AXES.map((_, i) => point(i, ring).join(",")).join(" ")}
            className="fill-none stroke-[#e1e0d9] dark:stroke-[#2c2c2a]"
            strokeWidth={1}
          />
        ))}
        {PROFILE_AXES.map((axis, i) => {
          const [x, y] = point(i, 100);
          const [lx, ly] = point(i, 124);
          return (
            <g key={axis}>
              <line
                x1={C}
                y1={C}
                x2={x}
                y2={y}
                className="stroke-[#e1e0d9] dark:stroke-[#2c2c2a]"
                strokeWidth={1}
              />
              <text
                x={lx}
                y={ly}
                textAnchor={Math.abs(lx - C) < 5 ? "middle" : lx > C ? "start" : "end"}
                dominantBaseline="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {t(`team.profile360.axes.${axis}`)}
              </text>
            </g>
          );
        })}
        <polygon
          points={polygon(team)}
          className="fill-none stroke-[#eb6834] dark:stroke-[#d95926]"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        <polygon
          points={polygon(person)}
          className="fill-[#2a78d6]/15 stroke-[#2a78d6] dark:fill-[#3987e5]/20 dark:stroke-[#3987e5]"
          strokeWidth={2}
        />
        {PROFILE_AXES.map((axis, i) => {
          const [x, y] = point(i, person[axis] ?? 0);
          return (
            <circle
              key={axis}
              cx={x}
              cy={y}
              r={4.5}
              className="fill-[#2a78d6] stroke-white dark:fill-[#3987e5] dark:stroke-[#1a1a19]"
              strokeWidth={2}
            >
              <title>{`${t(`team.profile360.axes.${axis}`)}: ${value(person[axis])} (${t("team.profile360.teamAverage")}: ${value(team[axis])})`}</title>
            </circle>
          );
        })}
      </svg>
      <table className="text-sm">
        <thead className="text-muted-foreground text-xs">
          <tr>
            <th className="py-1 text-left font-medium">{t("team.profile360.metric")}</th>
            <th className="py-1 text-right font-medium">{name}</th>
            <th className="py-1 text-right font-medium">{t("team.profile360.teamAverage")}</th>
          </tr>
        </thead>
        <tbody>
          {PROFILE_AXES.map((axis: ProfileAxis) => (
            <tr key={axis} className="border-t">
              <td className="py-1.5">
                {t(`team.profile360.axes.${axis}`)}
                <span className="text-muted-foreground block text-xs">
                  {t(`team.profile360.hints.${axis}`)}
                </span>
              </td>
              <td className="py-1.5 text-right font-semibold tabular-nums">
                {value(person[axis])}
              </td>
              <td className="py-1.5 text-right tabular-nums">{value(team[axis])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

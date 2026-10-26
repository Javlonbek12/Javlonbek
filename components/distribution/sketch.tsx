// A to-scale drawing of a display with the POSM on it: the frame by the equipment's height and
// width, its shelves, and each element where it goes (header on top, shelftalkers on the shelf
// edges, dividers and price tags on a shelf, the rest in the middle). A print wider than the
// display is drawn in red. Plain SVG without hooks: works on the server and in the browser.

export type SketchKind = "header" | "shelf" | "divider" | "tag" | "other";

export type SketchItem = {
  key: string;
  label: string;
  kind: SketchKind;
  heightMm: number | null;
  widthMm: number | null;
  // How many to draw (shelftalkers: one per shelf, up to the shelves).
  count: number;
  color: string;
};

export const sketchKind = (name: string): SketchKind =>
  /header|хедер|lightbox|лайтбокс|topper|топпер/i.test(name)
    ? "header"
    : /shelf|шелф|stopper|стоппер|strip|полос/i.test(name)
      ? "shelf"
      : /divider|раздел/i.test(name)
        ? "divider"
        : /ценник|price/i.test(name)
          ? "tag"
          : "other";

// A few clear colours for the elements, in a fixed order.
export const SKETCH_COLORS = ["#2a78d6", "#e8590c", "#2f9e44", "#ae3ec9", "#d6336c", "#0c8599"];

// Shelves of a type from its label: "POSI L (10*9)" → 9 rows.
export function rowsOf(label: string): number {
  const m = /\((\d+)\s*\*\s*(\d+)\)/.exec(label);
  return m ? Math.max(1, Number(m[2])) : 5;
}

export function EquipmentSketch({
  heightMm,
  widthMm,
  rows,
  items,
  height = 220,
}: {
  heightMm: number | null;
  widthMm: number | null;
  rows: number;
  items: SketchItem[];
  height?: number;
}) {
  if (!heightMm || !widthMm)
    return (
      <div
        className="text-muted-foreground bg-muted/40 flex items-center justify-center rounded-lg border border-dashed text-xs"
        style={{ height }}
      >
        ?
      </div>
    );
  const scale = height / heightMm;
  const W = widthMm * scale;
  const H = height;
  const pad = 14;
  // Tall displays: a header zone on top and a cabinet below the shelves; low ones: shelves only.
  const tall = heightMm > 1500;
  const top = H * (tall ? 0.14 : 0.12);
  const bottom = H * (tall ? 0.78 : 0.97);
  const shelfGap = (bottom - top) / rows;
  const shelves = Array.from({ length: rows }, (_, i) => top + shelfGap * (i + 1));
  const rect = (item: SketchItem) => ({
    w: Math.max(2, (item.widthMm ?? widthMm * 0.6) * scale),
    h: Math.max(2, (item.heightMm ?? 30) * scale),
    wide: item.widthMm !== null && item.widthMm > widthMm,
  });
  const shapes: React.ReactNode[] = [];
  let other = 0;
  for (const item of items) {
    const r = rect(item);
    const x = (W - r.w) / 2;
    const stroke = r.wide ? "#e03131" : item.color;
    const common = {
      fill: item.color,
      fillOpacity: 0.35,
      stroke,
      strokeWidth: r.wide ? 2 : 1,
    };
    if (item.kind === "header")
      shapes.push(
        <rect
          key={item.key}
          x={x}
          y={Math.max(2, (top - r.h) / 2)}
          width={r.w}
          height={r.h}
          {...common}
        >
          <title>{item.label}</title>
        </rect>,
      );
    else if (item.kind === "shelf")
      for (const [i, y] of shelves.slice(0, Math.max(1, Math.min(item.count, rows))).entries())
        shapes.push(
          <rect key={`${item.key}:${i}`} x={x} y={y - r.h} width={r.w} height={r.h} {...common}>
            <title>{item.label}</title>
          </rect>,
        );
    else if (item.kind === "divider")
      for (let i = 0; i < Math.min(Math.max(1, item.count), 6); i++) {
        const y = shelves[0]! - r.h;
        shapes.push(
          <rect
            key={`${item.key}:${i}`}
            x={(W / (Math.min(item.count, 6) + 1)) * (i + 1) - r.w / 2}
            y={y}
            width={r.w}
            height={r.h}
            {...common}
          >
            <title>{item.label}</title>
          </rect>,
        );
      }
    else if (item.kind === "tag")
      for (let i = 0; i < 4; i++)
        shapes.push(
          <rect
            key={`${item.key}:${i}`}
            x={(W / 5) * (i + 1) - r.w / 2}
            y={(shelves[1] ?? shelves[0]!) - r.h}
            width={r.w}
            height={r.h}
            {...common}
          >
            <title>{item.label}</title>
          </rect>,
        );
    else {
      const y = top + (bottom - top) / 2 - r.h / 2 + other * (r.h + 4);
      other += 1;
      shapes.push(
        <rect key={item.key} x={x} y={y} width={r.w} height={r.h} {...common}>
          <title>{item.label}</title>
        </rect>,
      );
    }
  }
  return (
    <svg
      viewBox={`${-pad} -4 ${W + pad * 2} ${H + 8}`}
      width={W + pad * 2}
      height={H + 8}
      className="mx-auto block max-w-full"
      role="img"
    >
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        rx={3}
        className="fill-card stroke-foreground/60"
        strokeWidth={1.5}
      />
      {tall && (
        <line
          x1={0}
          x2={W}
          y1={top}
          y2={top}
          className="stroke-foreground/25"
          strokeDasharray="3 3"
        />
      )}
      {shelves.map((y) => (
        <line key={y} x1={2} x2={W - 2} y1={y} y2={y} className="stroke-foreground/35" />
      ))}
      {tall && (
        <rect x={2} y={bottom + 2} width={W - 4} height={H - bottom - 4} className="fill-muted" />
      )}
      {shapes}
    </svg>
  );
}

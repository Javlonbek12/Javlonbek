import { slotKey, type Geometry, type Shelf } from "./geometry";

// Everything needed to draw one cell. Built from the database by export.ts.
export type RenderCell =
  | {
      kind: "SKU";
      brand: string;
      name: string;
      color: string;
      // The pack's sides in 3D: the average colour of the picture's edges (null: work it out).
      sideColor?: string | null;
      image: string | null; // data: URI
      price: string | null; // already formatted, e.g. "31 000"
      badges: string[];
    }
  | {
      kind: "POSM";
      name: string;
      color: string;
      image: string | null;
      span: number;
      // Shelves it covers downwards (a combo box over two shelves).
      rows?: number;
    }
  | { kind: "EMPTY" };

export type RenderInput = {
  geometry: Geometry;
  cells: Record<string, RenderCell>;
  // `aspect`: the picture's width / height — a horizontal header is as tall as its picture
  // needs to fill the width (within limits), not a thin strip.
  header?: { name: string; color: string; image: string | null; aspect?: number | null } | null;
  // The shelftalker of each shelf that holds one (shelf index → picture).
  shelftalkers?: Record<number, { name: string; color: string; image: string | null }>;
  // Outline colours for before/after comparison.
  highlight?: Map<string, "added" | "removed" | "moved" | "price">;
  // Bigger price tags for printing.
  large?: boolean;
};

const SLOT_W = 64;
const PACK_H = 104;
const GAP = 4;
const PAD = 16;
const SHELF_GAP = 14;
const HEADER_H = 56;
// A shelftalker strip under the price tags.
const TALKER_H = 26;
const VERTICAL_HEADER_W = 56;
// Extra room between the sections of a module (a group of slots), with a line in it.
const GROUP_GAP = 10;

const HIGHLIGHT = {
  added: "#16a34a",
  removed: "#dc2626",
  moved: "#2563eb",
  price: "#d97706",
} as const;
const BADGE_ON_PACK = new Set(["YANGI"]);

export function escapeXml(text: string): string {
  return text.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

// Splits a name into short lines for a narrow pack.
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && (last + " " + word).length <= maxChars)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word.slice(0, maxChars));
  }
  return lines.slice(0, maxLines);
}

// Where a slot column starts. Sections of a module are set apart; a shelf without sections
// (the short top row of a LEGO) follows the sections of the others, so its packs line up.
function sectionOf(geometry: Geometry, shelf: Shelf) {
  return shelf.group || (geometry.shelves.find((s) => s.group > 0)?.group ?? 0);
}

function columnX(group: number, column: number) {
  return PAD + column * SLOT_W + (group > 0 ? Math.floor(column / group) * GROUP_GAP : 0);
}

export function slotX(geometry: Geometry, shelf: Shelf, position: number) {
  return columnX(sectionOf(geometry, shelf), shelf.offset + position);
}

// The width of everything on the shelves.
function shelvesWidth(geometry: Geometry) {
  return Math.max(...geometry.shelves.map((s) => slotX(geometry, s, s.slots - 1) + SLOT_W - PAD));
}

export function planogramSize(input: RenderInput) {
  const tagH = input.large ? 34 : 24;
  // Shelves keep one pitch: with any shelftalker on the equipment, each gets room for one.
  const talkerH = input.geometry.shelves.some((s) => s.talker) ? TALKER_H : 0;
  const shelfH = PACK_H + tagH + talkerH + SHELF_GAP;
  const vertical = input.geometry.header === "vertical";
  const bandW = shelvesWidth(input.geometry);
  const aspect = input.header?.image ? input.header.aspect : null;
  const headerBand = aspect
    ? Math.round(Math.min(bandW * 0.45, Math.max(HEADER_H, bandW / aspect)))
    : HEADER_H;
  const headerH = input.geometry.header === "horizontal" ? headerBand + SHELF_GAP : 0;
  return {
    width: PAD * 2 + bandW + (vertical ? VERTICAL_HEADER_W + GAP * 2 : 0),
    height: PAD * 2 + headerH + input.geometry.shelves.length * shelfH,
    tagH,
    shelfH,
    headerH,
    headerBand,
    talkerH,
  };
}

// The drawing as separate elements: the picture (SVG) is made of them, and so is the PowerPoint
// slide, where every pack, price tag, POSM item and shelf is its own object. Texts belong to the
// box they sit in (a price tag is one object with its text). `part` says what an element is,
// `label` names it (the object's name in PowerPoint). Coordinates are in pixels of the picture.
export type ScenePart =
  | "background"
  | "header"
  | "talker"
  | "shelf"
  | "divider"
  | "slot"
  | "empty"
  | "posm"
  | "pack"
  | "badge"
  | "tag"
  | "highlight";

export type SceneText = {
  x: number; // centre
  y: number; // baseline
  text: string;
  size: number;
  bold?: boolean;
  color: string;
  rotate?: { angle: number; cx: number; cy: number };
};

export type SceneLabel = { part: ScenePart; shelf?: number; position?: number; name?: string };

export type SceneItem = SceneLabel &
  (
    | {
        type: "rect";
        x: number;
        y: number;
        w: number;
        h: number;
        rx?: number;
        fill: string;
        stroke?: string;
        dash?: string;
        strokeWidth?: number;
        texts?: SceneText[];
      }
    | {
        type: "image";
        x: number;
        y: number;
        w: number;
        h: number;
        href: string;
        fit: "meet" | "none";
      }
    | {
        type: "line";
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        stroke: string;
        width: number;
      }
  );

export function planogramScene(input: RenderInput) {
  const { width, height, tagH, shelfH, headerH, headerBand, talkerH } = planogramSize(input);
  const items: SceneItem[] = [
    { type: "rect", part: "background", x: 0, y: 0, w: width, h: height, fill: "#ffffff" },
  ];

  const header = input.header;
  if (input.geometry.header && header) {
    const vertical = input.geometry.header === "vertical";
    const x = vertical ? width - PAD - VERTICAL_HEADER_W : PAD;
    const w = vertical ? VERTICAL_HEADER_W : width - PAD * 2;
    const h = vertical ? height - PAD * 2 : headerBand;
    const label = { part: "header" as const, name: header.name };
    items.push({
      type: "rect",
      ...label,
      x,
      y: PAD,
      w,
      h,
      rx: 6,
      fill: header.color,
      texts: header.image
        ? undefined
        : [
            {
              x: x + w / 2,
              y: PAD + h / 2 + 6,
              text: header.name,
              size: 18,
              bold: true,
              color: "#fff",
              rotate: vertical ? { angle: -90, cx: x + w / 2, cy: PAD + h / 2 } : undefined,
            },
          ],
    });
    if (header.image)
      items.push({ type: "image", ...label, x, y: PAD, w, h, href: header.image, fit: "meet" });
  }

  // Slots of lower shelves a POSM item hangs over: not drawn. The items themselves are drawn
  // last, over the shelf boards they cross.
  const hidden = new Set<string>();
  for (const [key, cell] of Object.entries(input.cells))
    if (cell.kind === "POSM" && (cell.rows ?? 1) > 1) {
      const [s, p] = key.split(":").map(Number);
      for (let r = 1; r < cell.rows!; r++)
        for (let i = 0; i < cell.span; i++) hidden.add(slotKey(s + r, p + i));
    }
  const overlay: SceneItem[] = [];

  input.geometry.shelves.forEach((shelf, shelfIndex) => {
    const top = PAD + headerH + shelfIndex * shelfH;
    const left = slotX(input.geometry, shelf, 0);
    const shelfW = slotX(input.geometry, shelf, shelf.slots - 1) + SLOT_W - left;
    // The shelftalker on the shelf's edge (stretched to the shelf: it is printed for it), then
    // the shelf board.
    const strip = top + PACK_H + tagH + 2;
    if (shelf.talker) {
      const talker = input.shelftalkers?.[shelfIndex];
      const label = { part: "talker" as const, shelf: shelfIndex, name: talker?.name };
      items.push({
        type: "rect",
        ...label,
        x: left,
        y: strip,
        w: shelfW,
        h: talkerH - 4,
        rx: 2,
        fill: talker?.color ?? "#e2e8f0",
        texts:
          talker && !talker.image
            ? [
                {
                  x: left + shelfW / 2,
                  y: strip + talkerH / 2 + 2,
                  text: talker.name,
                  size: 12,
                  bold: true,
                  color: "#fff",
                },
              ]
            : undefined,
      });
      if (talker?.image)
        items.push({
          type: "image",
          ...label,
          x: left,
          y: strip,
          w: shelfW,
          h: talkerH - 4,
          href: talker.image,
          fit: "none",
        });
    }
    items.push({
      type: "rect",
      part: "shelf",
      shelf: shelfIndex,
      x: left - 2,
      y: shelf.talker ? strip + talkerH - 4 : strip,
      w: shelfW + 4,
      h: 4,
      fill: "#94a3b8",
    });
    for (let position = 0; position < shelf.slots; position++) {
      const key = slotKey(shelfIndex, position);
      const cell = input.cells[key];
      const x = slotX(input.geometry, shelf, position);
      const at = { shelf: shelfIndex, position };
      if (shelf.group > 0 && position > 0 && (shelf.offset + position) % shelf.group === 0) {
        const line = x - GROUP_GAP / 2;
        items.push({
          type: "line",
          part: "divider",
          ...at,
          x1: line,
          y1: top,
          x2: line,
          y2: top + PACK_H + tagH,
          stroke: "#cbd5e1",
          width: 2,
        });
      }
      if (hidden.has(key)) continue;
      if (!cell) {
        items.push({
          type: "rect",
          part: "slot",
          ...at,
          x: x + GAP / 2,
          y: top,
          w: SLOT_W - GAP,
          h: PACK_H,
          rx: 4,
          fill: "#f8fafc",
          stroke: "#cbd5e1",
          dash: "4 3",
        });
        continue;
      }
      if (cell.kind === "EMPTY") {
        items.push({
          type: "rect",
          part: "empty",
          ...at,
          x: x + GAP / 2,
          y: top,
          w: SLOT_W - GAP,
          h: PACK_H,
          rx: 4,
          fill: "#f1f5f9",
          stroke: "#e2e8f0",
          texts: [
            { x: x + SLOT_W / 2, y: top + PACK_H / 2 + 4, text: "—", size: 12, color: "#94a3b8" },
          ],
        });
        continue;
      }
      if (cell.kind === "POSM") {
        const w = slotX(input.geometry, shelf, position + cell.span - 1) + SLOT_W - x - GAP;
        const h = PACK_H + tagH + ((cell.rows ?? 1) - 1) * shelfH;
        const target = (cell.rows ?? 1) > 1 ? overlay : items;
        const label = { part: "posm" as const, ...at, name: cell.name };
        target.push({
          type: "rect",
          ...label,
          x: x + GAP / 2,
          y: top,
          w,
          h,
          rx: 6,
          fill: cell.color,
          texts: cell.image
            ? undefined
            : wrap(cell.name, Math.max(6, Math.floor(w / 9)), 3).map((line, i) => ({
                x: x + GAP / 2 + w / 2,
                y: top + 40 + i * 18,
                text: line,
                size: 14,
                bold: true,
                color: "#fff",
              })),
        });
        if (cell.image)
          target.push({
            type: "image",
            ...label,
            x: x + GAP / 2,
            y: top,
            w,
            h,
            href: cell.image,
            fit: "meet",
          });
        position += cell.span - 1;
        continue;
      }
      // A pack: picture (or coloured placeholder with the name), price tag, badges.
      const packX = x + GAP / 2;
      const packW = SLOT_W - GAP;
      const pack = { ...at, name: cell.name };
      if (cell.image) {
        items.push({
          type: "image",
          part: "pack",
          ...pack,
          x: packX,
          y: top,
          w: packW,
          h: PACK_H,
          href: cell.image,
          fit: "meet",
        });
      } else {
        const short = cell.name.replace(cell.brand, "").replace("(тест)", "").trim();
        items.push({
          type: "rect",
          part: "pack",
          ...pack,
          x: packX,
          y: top,
          w: packW,
          h: PACK_H,
          rx: 4,
          fill: cell.color,
          texts: [
            {
              x: x + SLOT_W / 2,
              y: top + 18,
              text: cell.brand.slice(0, 9),
              size: 11,
              bold: true,
              color: "#fff",
            },
            ...wrap(short, 9, 4).map((line, i) => ({
              x: x + SLOT_W / 2,
              y: top + 40 + i * 13,
              text: line,
              size: 10,
              color: "#fff",
            })),
          ],
        });
      }
      for (const badge of cell.badges.filter((b) => BADGE_ON_PACK.has(b))) {
        items.push({
          type: "rect",
          part: "badge",
          ...at,
          name: badge,
          x: packX + 4,
          y: top + PACK_H - 22,
          w: packW - 8,
          h: 16,
          rx: 8,
          fill: "#facc15",
          texts: [
            {
              x: x + SLOT_W / 2,
              y: top + PACK_H - 10,
              text: badge,
              size: 10,
              bold: true,
              color: "#111827",
            },
          ],
        });
      }
      const tagY = top + PACK_H + 2;
      const tagBadges = cell.badges.filter((b) => !BADGE_ON_PACK.has(b));
      const tagText = [cell.price, ...tagBadges].filter(Boolean).join(" ") || "—";
      // Long tags ("28 000 1mg") get a smaller font so they fit the pack width.
      const baseSize = input.large ? 14 : 10;
      const fontSize = Math.min(
        baseSize,
        Math.max(6, Math.floor((packW - 4) / (tagText.length * 0.62))),
      );
      items.push({
        type: "rect",
        part: "tag",
        ...pack,
        x: packX,
        y: tagY,
        w: packW,
        h: tagH - 4,
        rx: 3,
        fill: "#fff",
        stroke: "#111827",
        texts: [
          {
            x: x + SLOT_W / 2,
            y: tagY + tagH / 2 + fontSize / 3,
            text: tagText,
            size: fontSize,
            bold: true,
            color: "#111827",
          },
        ],
      });
      const mark = input.highlight?.get(key);
      if (mark) {
        items.push({
          type: "rect",
          part: "highlight",
          ...at,
          x: packX - 1,
          y: top - 1,
          w: packW + 2,
          h: PACK_H + tagH,
          rx: 5,
          fill: "none",
          stroke: HIGHLIGHT[mark],
          strokeWidth: 3,
        });
      }
    }
    // Highlights for removed items sit on cells that may be empty now.
    for (let position = 0; position < shelf.slots; position++) {
      const key = slotKey(shelfIndex, position);
      if (input.cells[key]?.kind === "SKU") continue;
      const mark = input.highlight?.get(key);
      if (mark) {
        const x = slotX(input.geometry, shelf, position) + GAP / 2;
        items.push({
          type: "rect",
          part: "highlight",
          shelf: shelfIndex,
          position,
          x: x - 1,
          y: top - 1,
          w: SLOT_W - GAP + 2,
          h: PACK_H + tagH,
          rx: 5,
          fill: "none",
          stroke: HIGHLIGHT[mark],
          strokeWidth: 3,
        });
      }
    }
  });

  items.push(...overlay);
  return { width, height, items };
}

function svgText(text: SceneText) {
  const weight = text.bold ? ` font-weight="bold"` : "";
  const transform = text.rotate
    ? ` transform="rotate(${text.rotate.angle} ${text.rotate.cx} ${text.rotate.cy})"`
    : "";
  return `<text x="${text.x}" y="${text.y}" text-anchor="middle" font-size="${text.size}"${weight} fill="${text.color}"${transform}>${escapeXml(text.text)}</text>`;
}

function svgItem(item: SceneItem): string {
  if (item.type === "line")
    return `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="${item.stroke}" stroke-width="${item.width}"/>`;
  if (item.type === "image")
    return `<image href="${item.href}" x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" preserveAspectRatio="${item.fit === "meet" ? "xMidYMid meet" : "none"}"/>`;
  if (item.part === "background")
    return `<rect width="${item.w}" height="${item.h}" fill="${item.fill}"/>`;
  const attrs = [
    `x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}"`,
    item.rx !== undefined ? `rx="${item.rx}"` : null,
    `fill="${item.fill}"`,
    item.stroke ? `stroke="${item.stroke}"` : null,
    item.dash ? `stroke-dasharray="${item.dash}"` : null,
    item.strokeWidth !== undefined ? `stroke-width="${item.strokeWidth}"` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `<rect ${attrs}/>` + (item.texts ?? []).map(svgText).join("");
}

// The planogram as an SVG picture (no external files: images are data URIs).
export function renderPlanogramSvg(input: RenderInput): string {
  const { width, height, items } = planogramScene(input);
  const font = `font-family="DejaVu Sans, Arial, sans-serif"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${font}>` +
    items.map(svgItem).join("") +
    "</svg>"
  );
}

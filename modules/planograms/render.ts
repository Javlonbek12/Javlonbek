import { slotKey, widthInSlots, type Geometry } from "./geometry";

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
  header?: { name: string; color: string; image: string | null } | null;
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
const VERTICAL_HEADER_W = 56;

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

export function planogramSize(input: RenderInput) {
  const tagH = input.large ? 34 : 24;
  const shelfH = PACK_H + tagH + SHELF_GAP;
  const vertical = input.geometry.header === "vertical";
  const headerH = input.geometry.header === "horizontal" ? HEADER_H + SHELF_GAP : 0;
  return {
    width:
      PAD * 2 +
      widthInSlots(input.geometry) * SLOT_W +
      (vertical ? VERTICAL_HEADER_W + GAP * 2 : 0),
    height: PAD * 2 + headerH + input.geometry.shelves.length * shelfH,
    tagH,
    shelfH,
    headerH,
  };
}

// The planogram as an SVG picture (no external files: images are data URIs).
export function renderPlanogramSvg(input: RenderInput): string {
  const { width, height, tagH, shelfH, headerH } = planogramSize(input);
  const font = `font-family="DejaVu Sans, Arial, sans-serif"`;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${font}>`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
  ];

  const header = input.header;
  if (input.geometry.header && header) {
    const vertical = input.geometry.header === "vertical";
    const x = vertical ? width - PAD - VERTICAL_HEADER_W : PAD;
    const w = vertical ? VERTICAL_HEADER_W : width - PAD * 2;
    const h = vertical ? height - PAD * 2 : HEADER_H;
    parts.push(
      `<rect x="${x}" y="${PAD}" width="${w}" height="${h}" rx="6" fill="${header.color}"/>`,
    );
    if (header.image) {
      parts.push(
        `<image href="${header.image}" x="${x}" y="${PAD}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    } else {
      const transform = vertical ? ` transform="rotate(-90 ${x + w / 2} ${PAD + h / 2})"` : "";
      parts.push(
        `<text x="${x + w / 2}" y="${PAD + h / 2 + 6}" text-anchor="middle" font-size="18" font-weight="bold" fill="#fff"${transform}>${escapeXml(header.name)}</text>`,
      );
    }
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
  const overlay: string[] = [];

  input.geometry.shelves.forEach((shelf, shelfIndex) => {
    const top = PAD + headerH + shelfIndex * shelfH;
    const left = PAD + shelf.offset * SLOT_W;
    // The shelf board under the price tags.
    parts.push(
      `<rect x="${left - 2}" y="${top + PACK_H + tagH + 2}" width="${shelf.slots * SLOT_W + 4}" height="4" fill="#94a3b8"/>`,
    );
    for (let position = 0; position < shelf.slots; position++) {
      const key = slotKey(shelfIndex, position);
      const cell = input.cells[key];
      const x = left + position * SLOT_W;
      if (hidden.has(key)) continue;
      if (shelf.group > 0 && position > 0 && position % shelf.group === 0) {
        parts.push(
          `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + PACK_H + tagH}" stroke="#cbd5e1" stroke-width="2"/>`,
        );
      }
      if (!cell) {
        parts.push(
          `<rect x="${x + GAP / 2}" y="${top}" width="${SLOT_W - GAP}" height="${PACK_H}" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="4 3"/>`,
        );
        continue;
      }
      if (cell.kind === "EMPTY") {
        parts.push(
          `<rect x="${x + GAP / 2}" y="${top}" width="${SLOT_W - GAP}" height="${PACK_H}" rx="4" fill="#f1f5f9" stroke="#e2e8f0"/>`,
          `<text x="${x + SLOT_W / 2}" y="${top + PACK_H / 2 + 4}" text-anchor="middle" font-size="12" fill="#94a3b8">—</text>`,
        );
        continue;
      }
      if (cell.kind === "POSM") {
        const w = cell.span * SLOT_W - GAP;
        const h = PACK_H + tagH + ((cell.rows ?? 1) - 1) * shelfH;
        const target = (cell.rows ?? 1) > 1 ? overlay : parts;
        target.push(
          `<rect x="${x + GAP / 2}" y="${top}" width="${w}" height="${h}" rx="6" fill="${cell.color}"/>`,
        );
        if (cell.image) {
          target.push(
            `<image href="${cell.image}" x="${x + GAP / 2}" y="${top}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`,
          );
        } else {
          wrap(cell.name, Math.max(6, Math.floor(w / 9)), 3).forEach((line, i) =>
            target.push(
              `<text x="${x + GAP / 2 + w / 2}" y="${top + 40 + i * 18}" text-anchor="middle" font-size="14" font-weight="bold" fill="#fff">${escapeXml(line)}</text>`,
            ),
          );
        }
        position += cell.span - 1;
        continue;
      }
      // A pack: picture (or coloured placeholder with the name), price tag, badges.
      const packX = x + GAP / 2;
      const packW = SLOT_W - GAP;
      if (cell.image) {
        parts.push(
          `<image href="${cell.image}" x="${packX}" y="${top}" width="${packW}" height="${PACK_H}" preserveAspectRatio="xMidYMid meet"/>`,
        );
      } else {
        parts.push(
          `<rect x="${packX}" y="${top}" width="${packW}" height="${PACK_H}" rx="4" fill="${cell.color}"/>`,
        );
        parts.push(
          `<text x="${x + SLOT_W / 2}" y="${top + 18}" text-anchor="middle" font-size="11" font-weight="bold" fill="#fff">${escapeXml(cell.brand.slice(0, 9))}</text>`,
        );
        const short = cell.name.replace(cell.brand, "").replace("(тест)", "").trim();
        wrap(short, 9, 4).forEach((line, i) =>
          parts.push(
            `<text x="${x + SLOT_W / 2}" y="${top + 40 + i * 13}" text-anchor="middle" font-size="10" fill="#fff">${escapeXml(line)}</text>`,
          ),
        );
      }
      for (const badge of cell.badges.filter((b) => BADGE_ON_PACK.has(b))) {
        parts.push(
          `<rect x="${packX + 4}" y="${top + PACK_H - 22}" width="${packW - 8}" height="16" rx="8" fill="#facc15"/>`,
          `<text x="${x + SLOT_W / 2}" y="${top + PACK_H - 10}" text-anchor="middle" font-size="10" font-weight="bold" fill="#111827">${escapeXml(badge)}</text>`,
        );
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
      parts.push(
        `<rect x="${packX}" y="${tagY}" width="${packW}" height="${tagH - 4}" rx="3" fill="#fff" stroke="#111827"/>`,
        `<text x="${x + SLOT_W / 2}" y="${tagY + tagH / 2 + fontSize / 3}" text-anchor="middle" font-size="${fontSize}" font-weight="bold" fill="#111827">${escapeXml(tagText)}</text>`,
      );
      const mark = input.highlight?.get(key);
      if (mark) {
        parts.push(
          `<rect x="${packX - 1}" y="${top - 1}" width="${packW + 2}" height="${PACK_H + tagH}" rx="5" fill="none" stroke="${HIGHLIGHT[mark]}" stroke-width="3"/>`,
        );
      }
    }
    // Highlights for removed items sit on cells that may be empty now.
    for (let position = 0; position < shelf.slots; position++) {
      const key = slotKey(shelfIndex, position);
      if (input.cells[key]?.kind === "SKU") continue;
      const mark = input.highlight?.get(key);
      if (mark) {
        const x = left + position * SLOT_W + GAP / 2;
        parts.push(
          `<rect x="${x - 1}" y="${top - 1}" width="${SLOT_W - GAP + 2}" height="${PACK_H + tagH}" rx="5" fill="none" stroke="${HIGHLIGHT[mark]}" stroke-width="3"/>`,
        );
      }
    }
  });

  parts.push(...overlay, "</svg>");
  return parts.join("");
}

import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";

import { db } from "@/lib/db";
import { formatDay, toDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";

import { describeChange } from "./describe";
import { diffLayouts, highlightCells, type LayoutChange } from "./diff";
import { readImage } from "./library";
import { formatPrice } from "./prices";
import { renderPlanogramSvg, type RenderCell, type RenderInput } from "./render";
import { loadPlanogram, type LoadedPlanogram } from "./repository";
import { changesVsPrevious } from "./service";
import { sideColorOf } from "./side-color";

const imageCache = new Map<string, string | null>();
const aspectCache = new Map<string, number | null>();

// Width / height of a picture (the header is drawn at its own proportions).
async function imageAspect(relative: string | null): Promise<number | null> {
  if (!relative) return null;
  if (aspectCache.has(relative)) return aspectCache.get(relative)!;
  const buffer = await readImage(relative);
  const meta = buffer ? await sharp(buffer).metadata() : null;
  const aspect = meta?.width && meta.height ? meta.width / meta.height : null;
  aspectCache.set(relative, aspect);
  return aspect;
}

// Small PNG thumbnail as a data URI (pictures inside the SVG must be self-contained).
async function dataUri(relative: string | null, height = 220): Promise<string | null> {
  if (!relative) return null;
  if (imageCache.has(relative)) return imageCache.get(relative)!;
  const buffer = await readImage(relative);
  const uri = buffer
    ? `data:image/png;base64,${(await sharp(buffer).resize({ height, withoutEnlargement: true }).png().toBuffer()).toString("base64")}`
    : null;
  imageCache.set(relative, uri);
  return uri;
}

// A picture by link instead of inline: pages load each picture once (and cache it) instead of
// carrying a copy of it in every cell. `base` is where pictures are served from.
const imageUrl = (
  base: string,
  kind: "sku" | "posm",
  id: string,
  relative: string | null,
  height: number,
) =>
  relative
    ? `${base}/${kind}/${id}?h=${height}&v=${encodeURIComponent(path.basename(relative))}`
    : null;

export async function buildRenderInput(
  loaded: LoadedPlanogram,
  options: { large?: boolean; highlight?: RenderInput["highlight"]; imageBase?: string } = {},
): Promise<RenderInput> {
  const [skus, posms] = await Promise.all([db.sku.findMany(), db.posm.findMany()]);
  // Pictures uploaded before side colours existed get theirs once, here.
  const used = new Set(
    Object.values(loaded.layout).flatMap((c) => (c.kind === "SKU" ? [c.skuId] : [])),
  );
  for (const sku of skus)
    if (used.has(sku.id) && sku.imagePath && !sku.sideColor) {
      const buffer = await readImage(sku.imagePath);
      sku.sideColor = buffer ? await sideColorOf(buffer) : null;
      if (sku.sideColor)
        await db.sku.update({ where: { id: sku.id }, data: { sideColor: sku.sideColor } });
    }
  const picture = (kind: "sku" | "posm", id: string, relative: string | null, height: number) =>
    options.imageBase
      ? imageUrl(options.imageBase, kind, id, relative, height * 2)
      : dataUri(relative, height);
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const posmById = new Map(posms.map((p) => [p.id, p]));
  const cells: Record<string, RenderCell> = {};
  for (const [key, content] of Object.entries(loaded.layout)) {
    if (content.kind === "EMPTY") cells[key] = { kind: "EMPTY" };
    else if (content.kind === "SKU") {
      const sku = skuById.get(content.skuId);
      if (!sku) continue;
      const price = loaded.prices.get(sku.id);
      cells[key] = {
        kind: "SKU",
        brand: sku.brand,
        name: sku.name,
        color: sku.color,
        sideColor: sku.imagePath ? sku.sideColor : null,
        image: await picture("sku", sku.id, sku.imagePath, 220),
        price: price === undefined ? null : formatPrice(price, sku.priceStyle),
        badges: content.badges,
      };
    } else {
      const posm = posmById.get(content.posmId);
      if (!posm) continue;
      cells[key] = {
        kind: "POSM",
        name: posm.name,
        color: posm.color,
        image: await picture("posm", posm.id, posm.imagePath, 300),
        span: content.span,
        rows: content.rows,
      };
    }
  }
  const header = loaded.record.headerPosm;
  const shelftalkers: NonNullable<RenderInput["shelftalkers"]> = {};
  for (const [shelf, posmId] of Object.entries(loaded.shelftalkers)) {
    const posm = posmById.get(posmId);
    if (posm)
      shelftalkers[Number(shelf)] = {
        name: posm.name,
        color: posm.color,
        image: await picture("posm", posm.id, posm.imagePath, 120),
      };
  }
  return {
    geometry: loaded.geometry,
    cells,
    header: header
      ? {
          name: header.name,
          color: header.color,
          image: await picture("posm", header.id, header.imagePath, 400),
          aspect: await imageAspect(header.imagePath),
        }
      : null,
    shelftalkers,
    large: options.large,
    highlight: options.highlight,
  };
}

export async function planogramSvg(
  loaded: LoadedPlanogram,
  options: { large?: boolean; imageBase?: string } = {},
) {
  return renderPlanogramSvg(await buildRenderInput(loaded, options));
}

export async function planogramPng(loaded: LoadedPlanogram): Promise<Buffer> {
  return sharp(Buffer.from(await planogramSvg(loaded)), { density: 144 })
    .png()
    .toBuffer();
}

export function slideTitle(loaded: LoadedPlanogram) {
  return `${loaded.record.equipment.name} ${loaded.record.channel}`;
}

export function slideSubtitle(loaded: LoadedPlanogram) {
  const r = loaded.record;
  return [
    r.project,
    r.title !== slideTitle(loaded) ? r.title : null,
    t("planograms.export.version", { version: r.version }),
    r.approvedAt ? formatDay(toDateString(r.approvedAt)) : formatDay(toDateString(r.updatedAt)),
    r.priceList ? t("planograms.export.prices", { name: r.priceList.name }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function changeLines(loaded: LoadedPlanogram, changes: LayoutChange[]) {
  const [skus, posms] = await Promise.all([
    db.sku.findMany({ select: { id: true, name: true } }),
    db.posm.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map([...skus, ...posms].map((x) => [x.id, x.name]));
  return changes.map((c) => describeChange(c, names));
}

type ExportItem = { loaded: LoadedPlanogram; png: Buffer; changes: string[] };

async function prepare(ids: string[]): Promise<ExportItem[]> {
  const items: ExportItem[] = [];
  for (const id of ids) {
    const loaded = await loadPlanogram(id);
    if (!loaded) continue;
    items.push({
      loaded,
      png: await planogramPng(loaded),
      changes: await changeLines(loaded, await changesVsPrevious(loaded)),
    });
  }
  return items;
}

// PPTX: one slide per planogram (title, subtitle, picture) + a "what changed" slide when there are changes.
export async function exportPptx(ids: string[]): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in
  for (const item of await prepare(ids)) {
    const meta = await sharp(item.png).metadata();
    const ratio = (meta.width ?? 1) / (meta.height ?? 1);
    const maxW = 12.3;
    const maxH = 5.9;
    const w = Math.min(maxW, maxH * ratio);
    const h = w / ratio;
    const slide = pptx.addSlide();
    slide.addText(slideTitle(item.loaded), {
      x: 0.5,
      y: 0.25,
      w: 12.3,
      h: 0.6,
      fontSize: 28,
      bold: true,
      fontFace: "Arial",
    });
    slide.addText(slideSubtitle(item.loaded), {
      x: 0.5,
      y: 0.8,
      w: 12.3,
      h: 0.4,
      fontSize: 14,
      color: "666666",
      fontFace: "Arial",
    });
    slide.addImage({
      data: `data:image/png;base64,${item.png.toString("base64")}`,
      x: (13.33 - w) / 2,
      y: 1.4,
      w,
      h,
    });
    if (item.changes.length > 0) {
      const changes = pptx.addSlide();
      changes.addText(`${slideTitle(item.loaded)} — ${t("planograms.export.changesTitle")}`, {
        x: 0.5,
        y: 0.25,
        w: 12.3,
        h: 0.6,
        fontSize: 24,
        bold: true,
        fontFace: "Arial",
      });
      changes.addText(
        item.changes.slice(0, 30).map((line) => ({ text: line, options: { bullet: true } })),
        { x: 0.5, y: 1.0, w: 12.3, h: 6.2, fontSize: 14, valign: "top", fontFace: "Arial" },
      );
    }
  }
  return Buffer.from((await pptx.write({ outputType: "nodebuffer" })) as ArrayBuffer);
}

const fontPath = (file: string) => path.join(process.cwd(), "assets", "fonts", file);

// PDF: one landscape A4 page per planogram (+ the list of changes), Cyrillic via DejaVu Sans.
export async function exportPdf(ids: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await readFile(fontPath("DejaVuSans.ttf")), { subset: true });
  const bold = await pdf.embedFont(await readFile(fontPath("DejaVuSans-Bold.ttf")), {
    subset: true,
  });
  const [W, H] = [842, 595];
  for (const item of await prepare(ids)) {
    const page = pdf.addPage([W, H]);
    page.drawText(slideTitle(item.loaded), { x: 36, y: H - 50, size: 20, font: bold });
    page.drawText(slideSubtitle(item.loaded), {
      x: 36,
      y: H - 70,
      size: 10,
      font: regular,
      color: rgb(0.4, 0.4, 0.4),
    });
    const image = await pdf.embedPng(item.png);
    const listW = item.changes.length > 0 ? 260 : 0;
    const scale = Math.min((W - 72 - listW) / image.width, (H - 110) / image.height);
    page.drawImage(image, {
      x: 36,
      y: H - 90 - image.height * scale,
      width: image.width * scale,
      height: image.height * scale,
    });
    if (item.changes.length > 0) {
      let y = H - 100;
      page.drawText(t("planograms.export.changesTitle"), {
        x: W - 36 - listW,
        y,
        size: 12,
        font: bold,
      });
      for (const line of item.changes.slice(0, 40)) {
        y -= 14;
        if (y < 30) break;
        page.drawText(`• ${line}`.slice(0, 70), { x: W - 36 - listW, y, size: 8, font: regular });
      }
    }
  }
  return Buffer.from(await pdf.save());
}

export async function planogramIdsForProject(project: string) {
  const rows = await db.planogram.findMany({
    where: {
      project,
      isTemplate: false,
      status: { in: ["APPROVED", "PENDING_APPROVAL", "DRAFT"] },
    },
    select: { id: true },
    orderBy: { title: "asc" },
  });
  return rows.map((r) => r.id);
}

export async function comparisonSvgs(beforeId: string, afterId: string) {
  const [before, after] = await Promise.all([loadPlanogram(beforeId), loadPlanogram(afterId)]);
  if (!before || !after) return null;
  const changes = diffLayouts(
    { layout: before.layout, geometry: before.geometry, prices: before.prices },
    { layout: after.layout, geometry: after.geometry, prices: after.prices },
  );
  const cells = highlightCells(changes);
  const priceMarks = new Map(cells.after);
  for (const change of changes) {
    if (change.type !== "price") continue;
    for (const [key, content] of Object.entries(after.layout)) {
      if (content.kind === "SKU" && content.skuId === change.id && !priceMarks.has(key))
        priceMarks.set(key, "price");
    }
  }
  return {
    before,
    after,
    beforeSvg: renderPlanogramSvg(await buildRenderInput(before, { highlight: cells.before })),
    afterSvg: renderPlanogramSvg(await buildRenderInput(after, { highlight: priceMarks })),
    lines: await changeLines(after, changes),
  };
}

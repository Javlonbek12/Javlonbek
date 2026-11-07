import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type PptxGenJS from "pptxgenjs";
import sharp from "sharp";

import { t, type TranslationKey } from "@/lib/i18n";

import type { SceneItem, SceneText, planogramScene } from "./render";

// A planogram on a PowerPoint slide as separate objects: every pack picture, price tag, badge,
// POSM item, shelftalker, shelf board and header is its own shape or picture, named after what it
// is ("Пачка: … — полка 2, место 5"), so it can be moved, changed or removed in PowerPoint.

type Scene = ReturnType<typeof planogramScene>;
type Box = { x: number; y: number; w: number; h: number };

// Pictures as files: PowerPoint then keeps one copy of a picture used by many packs on a slide.
export class PictureFiles {
  private dir: string | null = null;
  private files = new Map<string, { path: string; width: number; height: number } | null>();

  async get(href: string) {
    if (this.files.has(href)) return this.files.get(href)!;
    const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(href);
    let file: { path: string; width: number; height: number } | null = null;
    if (match) {
      const buffer = Buffer.from(match[2]!, "base64");
      const meta = await sharp(buffer).metadata();
      this.dir ??= await mkdtemp(path.join(os.tmpdir(), "planogram-pptx-"));
      const name = `${createHash("sha1").update(href).digest("hex")}.${match[1] === "jpeg" ? "jpg" : "png"}`;
      const target = path.join(this.dir, name);
      await writeFile(target, buffer);
      file = { path: target, width: meta.width ?? 1, height: meta.height ?? 1 };
    }
    this.files.set(href, file);
    return file;
  }

  // After the presentation is written.
  async clear() {
    if (this.dir) await rm(this.dir, { recursive: true, force: true });
    this.dir = null;
    this.files.clear();
  }
}

const hex = (color: string) => {
  const value = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(value))
    return value
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase();
  return "CCCCCC";
};

const PART_KEYS: Record<SceneItem["part"], TranslationKey | null> = {
  background: null,
  header: "planograms.export.parts.header",
  talker: "planograms.export.parts.talker",
  shelf: "planograms.export.parts.shelf",
  divider: "planograms.export.parts.divider",
  slot: "planograms.export.parts.slot",
  empty: "planograms.export.parts.empty",
  posm: "planograms.export.parts.posm",
  pack: "planograms.export.parts.pack",
  badge: "planograms.export.parts.badge",
  tag: "planograms.export.parts.tag",
  highlight: "planograms.export.parts.highlight",
};

// "Пачка: ESSE Change — полка 2, место 5".
export function objectName(item: SceneItem, suffix = "") {
  const key = PART_KEYS[item.part];
  if (!key) return "";
  const head = t(key, { name: item.name ?? "", shelf: (item.shelf ?? 0) + 1 }).replace(/:\s*$/, "");
  const where =
    item.position !== undefined
      ? t("planograms.export.parts.where", {
          shelf: (item.shelf ?? 0) + 1,
          position: item.position + 1,
        })
      : "";
  return `${head}${where ? ` — ${where}` : ""}${suffix}`.slice(0, 250);
}

// Puts the scene into `box` (inches) on the slide, keeping its proportions.
export async function addSceneToSlide(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  scene: Scene,
  box: Box,
  pictures: PictureFiles,
) {
  const scale = Math.min(box.w / scene.width, box.h / scene.height); // inches per pixel
  const left = box.x + (box.w - scene.width * scale) / 2;
  const top = box.y;
  const X = (px: number) => left + px * scale;
  const Y = (px: number) => top + px * scale;
  const L = (px: number) => px * scale;
  const pt = (px: number) => Math.round(px * scale * 72 * 10) / 10;

  for (const [index, item] of scene.items.entries()) {
    if (item.part === "background") continue;
    if (item.type === "line") {
      slide.addShape(pptx.ShapeType.line, {
        x: X(item.x1),
        y: Y(item.y1),
        w: L(item.x2 - item.x1),
        h: L(item.y2 - item.y1),
        line: { color: hex(item.stroke), width: pt(item.width) },
        objectName: objectName(item),
      });
      continue;
    }
    if (item.type === "image") {
      const file = await pictures.get(item.href);
      if (!file) continue;
      let { x, y, w, h } = item;
      if (item.fit === "meet") {
        // The picture at its own proportions inside the cell, centred (as in the picture).
        const ratio = file.width / file.height;
        if (w / h > ratio) {
          const fitted = h * ratio;
          x += (w - fitted) / 2;
          w = fitted;
        } else {
          const fitted = w / ratio;
          y += (h - fitted) / 2;
          h = fitted;
        }
      }
      slide.addImage({
        path: file.path,
        x: X(x),
        y: Y(y),
        w: L(w),
        h: L(h),
        objectName: objectName(item),
      });
      continue;
    }
    // A box: a picture right after it on the same place is its background.
    const next = scene.items[index + 1];
    const background =
      next?.type === "image" &&
      next.part === item.part &&
      next.shelf === item.shelf &&
      next.position === item.position;
    const shape = item.rx ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
    const options = {
      x: X(item.x),
      y: Y(item.y),
      w: L(item.w),
      h: L(item.h),
      ...(item.rx ? { rectRadius: Math.min(L(item.rx), L(Math.min(item.w, item.h)) / 2) } : {}),
      ...(item.fill !== "none" ? { fill: { color: hex(item.fill) } } : {}),
      line: item.stroke
        ? {
            color: hex(item.stroke),
            width: pt(item.strokeWidth ?? 1),
            dashType: item.dash ? ("dash" as const) : ("solid" as const),
          }
        : undefined,
      objectName: objectName(
        item,
        background ? ` (${t("planograms.export.parts.background")})` : "",
      ),
    };
    const texts = item.texts ?? [];
    if (texts.length === 0) {
      slide.addShape(shape, options);
      continue;
    }
    slide.addText(
      texts.map((text, i) => ({
        text: text.text,
        options: {
          fontSize: pt(text.size),
          bold: text.bold ?? false,
          color: hex(text.color),
          breakLine: i < texts.length - 1,
        },
      })),
      {
        ...options,
        shape,
        fontFace: "Arial",
        align: "center",
        wrap: false,
        ...placement(item, texts, pt),
      },
    );
  }
}

// Where the text sits in its box: a single line near the middle is centred; lines that start
// lower (a pack's name under its brand) keep their distance from the top.
function placement(item: { y: number; h: number }, texts: SceneText[], pt: (px: number) => number) {
  const first = texts[0]!;
  if (first.rotate) return { valign: "middle" as const, vert: "vert270" as const, margin: 0 };
  const centre = first.y - first.size * 0.35;
  if (texts.length === 1 && Math.abs(centre - (item.y + item.h / 2)) <= item.h * 0.15)
    return { valign: "middle" as const, margin: 0 };
  const gap = Math.max(0, first.y - first.size * 0.95 - item.y);
  return { valign: "top" as const, margin: [0, 0, 0, pt(gap)] as [number, number, number, number] };
}

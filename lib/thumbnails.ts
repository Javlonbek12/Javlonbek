import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { getEnv } from "@/lib/env";

// Smaller WebP copies of uploaded pictures for pages that show them small (a post's thumbnail in
// the content plan, a campaign's picture): a phone photo of several megabytes becomes a few dozen
// kilobytes. Made once per picture and width, then kept next to the uploads (.thumbs) and read
// from there. Only these widths, so the folder can't be filled with every possible size.
export const THUMB_WIDTHS = [96, 160, 320, 640, 1200] as const;

// The smallest allowed width that covers the asked one (?w=…); null without one or out of range.
export function thumbWidth(raw: string | null): number | null {
  const asked = Number(raw);
  if (!raw || !Number.isFinite(asked) || asked < 16 || asked > 2400) return null;
  return THUMB_WIDTHS.find((w) => w >= asked) ?? THUMB_WIDTHS.at(-1)!;
}

// Pictures that get copies; a GIF keeps its animation only as the original.
export const THUMBABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

const root = () => path.resolve(getEnv().UPLOAD_DIR);

// `source`: the picture's file (or its bytes, already read). `key`: what identifies its content (its
// stored path; a new upload gets a new one).
export async function thumbnail(
  source: string | Buffer,
  key: string,
  options: { width?: number; height?: number },
): Promise<Buffer | null> {
  const size = options.width ? `w${options.width}` : `h${options.height}`;
  const name = `${createHash("sha1").update(key).digest("hex")}-${size}.webp`;
  const cached = path.join(root(), ".thumbs", name);
  try {
    return await readFile(cached);
  } catch {
    // Not made yet.
  }
  let webp: Buffer;
  try {
    webp = await sharp(typeof source === "string" ? await readFile(source) : source)
      .rotate()
      .resize({ ...options, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
  try {
    await mkdir(path.dirname(cached), { recursive: true });
    // Written aside, then renamed: a half-written copy is never read.
    const temporary = `${cached}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, webp);
    await rename(temporary, cached);
  } catch {
    // No room to keep it: still served this time.
  }
  return webp;
}

// Uploaded files never change under their link (a new upload gets a new one): the browser may
// keep them.
export const LONG_CACHE = "private, max-age=31536000, immutable";

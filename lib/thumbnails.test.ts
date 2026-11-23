// @vitest-environment node
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { getEnv } from "@/lib/env";

import { thumbnail, thumbWidth } from "./thumbnails";

describe("thumbWidth", () => {
  it("takes the smallest allowed width that covers the asked one", () => {
    expect(thumbWidth("160")).toBe(160);
    expect(thumbWidth("100")).toBe(160);
    expect(thumbWidth("50")).toBe(96);
    expect(thumbWidth("2000")).toBe(1200);
  });

  it("gives none without a usable width", () => {
    expect(thumbWidth(null)).toBeNull();
    expect(thumbWidth("")).toBeNull();
    expect(thumbWidth("abc")).toBeNull();
    expect(thumbWidth("5")).toBeNull();
    expect(thumbWidth("99999")).toBeNull();
  });
});

describe("thumbnail", () => {
  const thumbs = path.join(path.resolve(getEnv().UPLOAD_DIR), ".thumbs");
  afterAll(() => rm(thumbs, { recursive: true, force: true }));

  it("makes a small WebP copy once and then reads it from disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "thumb-"));
    const photo = path.join(dir, "photo.png");
    await writeFile(
      photo,
      await sharp({
        create: { width: 2000, height: 1000, channels: 3, background: "#3366cc" },
      })
        .png()
        .toBuffer(),
    );
    const small = await thumbnail(photo, `test/${Date.now()}/photo.png`, { width: 160 });
    expect(small).not.toBeNull();
    const meta = await sharp(small!).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 160, 80]);

    // The copy is kept: it is served even after the original is gone.
    const key = `test/${Date.now()}/kept.png`;
    await thumbnail(photo, key, { width: 96 });
    await rm(dir, { recursive: true, force: true });
    expect(await thumbnail(photo, key, { width: 96 })).not.toBeNull();
    expect((await readdir(thumbs)).some((name) => name.endsWith("-w96.webp"))).toBe(true);
  });

  it("gives none for what is not a picture", async () => {
    expect(
      await thumbnail(Buffer.from("not a picture"), `test/${Date.now()}/x`, { width: 96 }),
    ).toBeNull();
  });
});

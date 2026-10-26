import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { sideColorOf } from "./side-color";

describe("sideColorOf", () => {
  it("takes the colour of the picture's edges, not of its middle", async () => {
    // A red pack picture with a blue square in the middle.
    const middle = await sharp({
      create: { width: 60, height: 100, channels: 3, background: "#0000ff" },
    })
      .png()
      .toBuffer();
    const image = await sharp({
      create: { width: 100, height: 160, channels: 3, background: "#cc2200" },
    })
      .composite([{ input: middle, left: 20, top: 30 }])
      .png()
      .toBuffer();
    expect(await sideColorOf(image)).toBe("#cc2200");
  });

  it("is null for something that isn't a picture", async () => {
    expect(await sideColorOf(Buffer.from("not an image"))).toBeNull();
  });
});

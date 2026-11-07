// @vitest-environment node
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { EQUIPMENT_FIXTURES } from "./fixtures";
import { addSceneToSlide, objectName, PictureFiles } from "./pptx-scene";
import { planogramScene, type RenderInput } from "./render";

const displayL = EQUIPMENT_FIXTURES.find((e) => e.code === "DISPLAY_L")!.geometry;

async function packPicture() {
  const png = await sharp({
    create: { width: 30, height: 60, channels: 3, background: "#1d4ed8" },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function input(): Promise<RenderInput> {
  const picture = await packPicture();
  const pack = (price: string, badges: string[] = []) => ({
    kind: "SKU" as const,
    brand: "ESSE",
    name: "ESSE Change (тест)",
    color: "#1d4ed8",
    image: picture,
    price,
    badges,
  });
  return {
    geometry: displayL,
    header: { name: "Тестовый хедер", color: "#111827", image: null },
    cells: {
      "0:0": pack("28 000", ["YANGI", "1mg"]),
      "0:1": pack("31 000"),
      "0:2": { ...pack("24 000"), image: null },
      "1:0": { kind: "POSM", name: "Тестовый баннер", color: "#15803d", image: null, span: 3 },
      "2:0": { kind: "EMPTY" },
    },
  };
}

describe("the planogram as separate objects", () => {
  it("every pack, price tag, badge, POSM item and shelf is its own element", async () => {
    const scene = planogramScene(await input());
    const parts = (part: string) => scene.items.filter((i) => i.part === part);
    expect(parts("pack")).toHaveLength(3);
    expect(parts("tag").map((i) => (i.type === "rect" ? i.texts?.[0]?.text : null))).toEqual([
      "28 000 1mg",
      "31 000",
      "24 000",
    ]);
    expect(parts("badge")).toHaveLength(1);
    expect(parts("posm")).toHaveLength(1);
    expect(parts("empty")).toHaveLength(1);
    expect(parts("shelf")).toHaveLength(displayL.shelves.length);
    expect(parts("header")).toHaveLength(1);
    // A pack is where its cell is.
    expect(parts("pack")[1]).toMatchObject({ shelf: 0, position: 1 });
  });

  it("names objects after what they are and where", async () => {
    const scene = planogramScene(await input());
    const tag = scene.items.find((i) => i.part === "tag" && i.position === 1)!;
    expect(objectName(tag)).toBe("Ценник: ESSE Change (тест) — полка 1, место 2");
    const shelf = scene.items.find((i) => i.part === "shelf" && i.shelf === 2)!;
    expect(objectName(shelf)).toBe("Полка 3");
    const header = scene.items.find((i) => i.part === "header")!;
    expect(objectName(header)).toBe("Хедер: Тестовый хедер");
  });

  it("puts them on a slide: shapes with text, pictures kept once", async () => {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    const slide = pptx.addSlide();
    const pictures = new PictureFiles();
    try {
      await addSceneToSlide(
        pptx,
        slide,
        planogramScene(await input()),
        { x: 0.5, y: 1.4, w: 12.3, h: 5.9 },
        pictures,
      );
      const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
      const zip = await JSZip.loadAsync(buffer);
      const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      expect(xml).toContain('name="Пачка: ESSE Change (тест) — полка 1, место 1"');
      expect(xml).toContain('name="Ценник: ESSE Change (тест) — полка 1, место 1"');
      expect(xml).toContain("<a:t>28 000 1mg</a:t>");
      expect(xml).toContain('name="POSM: Тестовый баннер — полка 2, место 1"');
      expect(xml).toContain("<a:t>Тестовый хедер</a:t>");
      // Two packs with the same picture: one picture file.
      const media = Object.values(zip.files).filter(
        (f) => !f.dir && f.name.startsWith("ppt/media/"),
      );
      expect(media).toHaveLength(1);
      expect((xml.match(/<p:pic>/g) ?? []).length).toBe(2);
    } finally {
      await pictures.clear();
    }
  });
});

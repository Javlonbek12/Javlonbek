import sharp from "sharp";

import { edgeColor } from "./scene3d";

// A pack picture's side colour (see edgeColor), from a small copy of it. Null for a picture
// sharp can't read or with fully transparent edges.
export async function sideColorOf(image: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(image)
      .resize({ height: 64, withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return edgeColor(data, info.width, info.height, 4);
  } catch {
    return null;
  }
}

import { thumbnail } from "@/lib/thumbnails";

// A pack / POSM picture as an HTTP response. With ?h=… it is a smaller WebP copy (pages show
// pictures small, and WebP is several times lighter than PNG for photos); without it, the PNG as stored.
// Links carry the picture's file name (?v=…), so a changed picture gets a new link and the old
// one can be cached for long. `key` (the stored path): the smaller copy is made once and kept.
export async function pictureResponse(image: Buffer, url: string, key: string) {
  const params = new URL(url).searchParams;
  const height = Number(params.get("h"));
  const cache = params.has("v") ? "private, max-age=31536000, immutable" : "private, max-age=86400";
  if (Number.isInteger(height) && height >= 32 && height <= 1200) {
    const webp = await thumbnail(image, key, { height });
    if (webp)
      return new Response(new Uint8Array(webp), {
        headers: { "Content-Type": "image/webp", "Cache-Control": cache },
      });
  }
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": "image/png", "Cache-Control": cache },
  });
}

import { db } from "@/lib/db";

import { formatPrice } from "./prices";
import { loadPlanogram, type LoadedPlanogram } from "./repository";

const imageUrl = (kind: "sku" | "posm", id: string, path: string | null) =>
  path ? `/api/planogram-images/${kind}/${id}?v=${encodeURIComponent(path)}` : null;

// Plain data for the client-side editor.
export async function editorData(loaded: LoadedPlanogram) {
  const [skus, posms] = await Promise.all([
    db.sku.findMany({
      where: { OR: [{ archived: false }, { slots: { some: { planogramId: loaded.record.id } } }] },
      orderBy: [{ brand: "asc" }, { code: "asc" }],
    }),
    db.posm.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
  ]);
  const toPosm = (p: (typeof posms)[number]) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    span: p.slotSpan,
    color: p.color,
    imageUrl: imageUrl("posm", p.id, p.imagePath),
  });
  const previous = loaded.record.previousVersionId
    ? await loadPlanogram(loaded.record.previousVersionId)
    : null;
  return {
    skus: skus.map((s) => ({
      id: s.id,
      code: s.code,
      brand: s.brand,
      name: s.name,
      color: s.color,
      imageUrl: imageUrl("sku", s.id, s.imagePath),
      price: loaded.prices.has(s.id) ? formatPrice(loaded.prices.get(s.id)!, s.priceStyle) : null,
      isNew: s.isNew,
      isMandatory: s.isMandatory,
      defaultBadges: s.defaultBadges,
    })),
    posms: posms.filter((p) => p.type !== "HEADER").map(toPosm),
    headers: posms.filter((p) => p.type === "HEADER").map(toPosm),
    prices: Object.fromEntries(loaded.prices),
    previous: previous
      ? {
          layout: previous.layout,
          geometry: previous.geometry,
          prices: Object.fromEntries(previous.prices),
        }
      : null,
  };
}

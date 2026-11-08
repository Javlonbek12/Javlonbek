import { db } from "@/lib/db";

import { formatPrice } from "./prices";
import { loadPlanogram, type LoadedPlanogram } from "./repository";
import { withMandatory } from "./validate";

// Light copies sized for the editor's cells (a pack is 84 px high; ×2 for sharp screens).
const imageUrl = (kind: "sku" | "posm", id: string, path: string | null) =>
  path
    ? `/api/planogram-images/${kind}/${id}?h=${kind === "sku" ? 180 : 240}&v=${encodeURIComponent(path)}`
    : null;

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
    rows: p.shelfSpan,
    color: p.color,
    imageUrl: imageUrl("posm", p.id, p.imagePath),
  });
  const previous = loaded.record.previousVersionId
    ? await loadPlanogram(loaded.record.previousVersionId)
    : null;
  // Mandatory on this model: its own list, else the SKUs marked so (never an archived one).
  const mandatory = new Set(
    withMandatory(skus, loaded.record.equipment.mandatorySkuIds)
      .filter((s) => s.isMandatory)
      .map((s) => s.id),
  );
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
      isMandatory: mandatory.has(s.id),
      defaultBadges: s.defaultBadges,
    })),
    posms: posms.filter((p) => p.type !== "HEADER" && p.type !== "SHELFTALKER").map(toPosm),
    headers: posms.filter((p) => p.type === "HEADER").map(toPosm),
    shelftalkers: posms.filter((p) => p.type === "SHELFTALKER").map(toPosm),
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

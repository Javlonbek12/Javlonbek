export type PriceStyle = "NUMBER" | "MING";

// "31 000" or, for brands that use it, "18 ming".
export function formatPrice(price: number, style: PriceStyle = "NUMBER"): string {
  if (style === "MING" && price % 1000 === 0) return `${price / 1000} ming`;
  return String(price).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export type PriceChange = { skuId: string; from: number | null; to: number | null };

// Price changes for the given SKUs between two price lists.
export function priceChanges(
  skuIds: Iterable<string>,
  oldPrices: Map<string, number>,
  newPrices: Map<string, number>,
): PriceChange[] {
  const changes: PriceChange[] = [];
  for (const skuId of new Set(skuIds)) {
    const from = oldPrices.get(skuId) ?? null;
    const to = newPrices.get(skuId) ?? null;
    if (from !== to) changes.push({ skuId, from, to });
  }
  return changes;
}

// A new price list keeps every price of the previous one and overrides the uploaded rows,
// so uploading only the changed SKUs is enough.
export function mergePriceLists(
  previous: Map<string, number>,
  uploaded: Map<string, number>,
): Map<string, number> {
  return new Map([...previous, ...uploaded]);
}

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import type { SlotContent } from "@/modules/planograms/layout";

export const SLOT_W = 52;
export const PACK_H = 84;
// Shelf to shelf in the editor: a cell (PACK_H + 20, padding 4), the board (4 + 4), the gap 12.
export const SHELF_PITCH = PACK_H + 20 + 4 + 8 + 12;
// A shelftalker strip on a shelf's edge takes the board's place (4 px) in the editor.
export const TALKER_H = 18;

export type EditorSku = {
  id: string;
  code: string;
  brand: string;
  name: string;
  color: string;
  imageUrl: string | null;
  price: string | null;
  isNew: boolean;
  isMandatory: boolean;
  defaultBadges: string[];
};

export type EditorPosm = {
  id: string;
  name: string;
  type: string;
  span: number;
  // Shelves it covers downwards.
  rows: number;
  color: string;
  imageUrl: string | null;
};

const ON_PACK = new Set(["YANGI"]);

// One cell of the editor: a pack with its price tag and badges, a POSM item, or an empty slot.
export function SlotView({
  content,
  sku,
  posm,
  selected,
  violation,
  style,
  height,
}: {
  content: SlotContent | undefined;
  sku?: EditorSku;
  posm?: EditorPosm;
  selected?: boolean;
  violation?: boolean;
  style?: CSSProperties;
  // A POSM over several shelves: its height (the shelves differ when some have shelftalkers).
  height?: number;
}) {
  const ring = cn(
    selected && "ring-2 ring-blue-500",
    violation && !selected && "ring-2 ring-red-500",
  );
  if (content?.kind === "POSM" && posm) {
    const rows = content.rows ?? 1;
    const block = (
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-md text-center text-[11px] font-bold text-white",
          rows > 1 && "absolute top-0 left-0 z-10",
          ring,
        )}
        style={{
          width: posm.span * SLOT_W - 4,
          // Over several shelves it hangs down over the lower ones.
          height: height ?? PACK_H + 20 + (rows - 1) * SHELF_PITCH,
          background: posm.color,
          ...style,
        }}
        title={posm.name}
      >
        {posm.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posm.imageUrl} alt={posm.name} className="h-full w-full object-contain" />
        ) : (
          <span className="px-1">{posm.name}</span>
        )}
      </div>
    );
    if (rows <= 1) return block;
    // The shelf row keeps one shelf's height; the block overflows downwards.
    return (
      <div className="relative" style={{ width: posm.span * SLOT_W - 4, height: PACK_H + 20 }}>
        {block}
      </div>
    );
  }
  if (content?.kind === "SKU" && sku) {
    const tag = [sku.price, ...content.badges.filter((b) => !ON_PACK.has(b))]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        className={cn("flex flex-col gap-0.5 rounded-md", ring)}
        style={{ width: SLOT_W - 4, ...style }}
        title={`${sku.name}${sku.price ? ` — ${sku.price}` : ""}`}
      >
        <div
          className="relative overflow-hidden rounded"
          style={{ height: PACK_H, background: sku.imageUrl ? "transparent" : sku.color }}
        >
          {sku.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sku.imageUrl} alt={sku.name} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full flex-col items-center px-0.5 pt-1 text-center text-white">
              <span className="text-[9px] font-bold">{sku.brand}</span>
              <span className="text-[9px] leading-tight">
                {sku.name.replace(sku.brand, "").replace("(тест)", "").trim()}
              </span>
            </div>
          )}
          {content.badges
            .filter((b) => ON_PACK.has(b))
            .map((b) => (
              <span
                key={b}
                className="absolute inset-x-1 top-1 rounded-full bg-yellow-400 text-center text-[9px] font-bold text-gray-900"
              >
                {b}
              </span>
            ))}
        </div>
        <div className="truncate rounded border border-gray-900 bg-white text-center text-[9px] leading-4 font-bold text-gray-900">
          {tag || "—"}
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md border text-[10px]",
        content?.kind === "EMPTY"
          ? "border-slate-200 bg-slate-100 text-slate-400"
          : "border-dashed border-slate-300 bg-slate-50 text-slate-300",
        ring,
      )}
      style={{ width: SLOT_W - 4, height: PACK_H + 20, ...style }}
    >
      {content?.kind === "EMPTY" ? "—" : "+"}
    </div>
  );
}

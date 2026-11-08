import { z } from "zod";

import { db } from "@/lib/db";
import { runStructured, type ModelCall } from "@/modules/ai/run";
import type { Actor } from "@/modules/core/permissions";

import { canManagePlanograms } from "./access";
import { PlanogramError } from "./errors";
import { slotKey, type Geometry } from "./geometry";
import { coveredSlots, type Layout, type SkuInfo } from "./layout";
import { loadPlanogram, loadSkuInfos } from "./repository";
import { DEFAULT_BRAND_ORDER, withMandatory } from "./validate";

// «Предложить раскладку ИИ»: the manager describes the shelves in words, Claude answers with the
// SKUs of each shelf left to right, and the code puts them into the places it may use. POSM always
// stays; in «free» mode the packs and «пусто» marks already there stay too and only the places
// nobody decided are filled, in «all» mode every pack is placed again. Places the answer leaves
// over stay undecided, so the «every place decided» rule shows the gap. The result goes into the
// editor as an unsaved change (undo takes it back).

export type AiLayoutMode = "free" | "all";

export const MAX_REQUEST = 1000;
const MAX_FACINGS = 8;

export const aiLayoutSchema = z.object({
  shelves: z.array(
    z.object({
      // 1 = the top shelf.
      shelf: z.number().int(),
      items: z.array(z.object({ code: z.string(), facings: z.number().int() })),
    }),
  ),
  // One or two sentences to the manager, in the language of the request.
  note: z.string(),
});

export type AiLayoutAnswer = z.infer<typeof aiLayoutSchema>;

export const AI_LAYOUT_SYSTEM = `You arrange cigarette packs on a store shelf unit (a planogram) for a tobacco company's trade marketing team.

The unit has shelves numbered from the top (shelf 1 = top). Each shelf has places in a row, left to right; one place holds one facing (one pack front). Some places are taken by POSM (displays, wobblers) and are not yours.

Return, for every shelf, the SKUs left to right with their facings:
- Use only codes from the catalog, exactly as written there. Never invent a code.
- The facings of a shelf should add up to its free places, no more. Facings are 1 to 4 unless the request asks otherwise.
- Follow the request first. Where it says nothing, keep the usual rules: every mandatory SKU (marked "mandatory") is on the unit; each brand stands as one block, brands in the brand order given; new items (marked "new") go on the top shelf or wherever the request puts them; the bigger brands get more facings.
- Keep from the current layout what the request does not ask to change.
- note: one or two short sentences to the manager about what you did and anything you could not do, in the language of the request (usually Russian).`;

type PromptSku = Pick<SkuInfo, "code" | "brand" | "name" | "isNew" | "isMandatory">;

// What the model sees: the shelves with their free places, the layout now, the catalog, the request.
export function aiLayoutPrompt(input: {
  geometry: Geometry;
  layout: Layout;
  skus: (PromptSku & { id: string })[];
  posmNames: Map<string, string>;
  request: string;
  brandOrder?: string[];
  mode?: AiLayoutMode;
}) {
  const { geometry, layout, skus, posmNames, request } = input;
  const mode = input.mode ?? "all";
  const covered = coveredSlots(layout);
  const code = new Map(skus.map((s) => [s.id, s.code]));
  const shelves = geometry.shelves.map((shelf, index) => {
    const free = freePlaces(geometry, layout, index, covered, mode).length;
    const posm = [
      ...new Set(
        Array.from({ length: shelf.slots }, (_, p) => layout[slotKey(index, p)])
          .filter((c) => c?.kind === "POSM")
          .map((c) => (c?.kind === "POSM" ? (posmNames.get(c.posmId) ?? "POSM") : "")),
      ),
    ];
    const taken = shelf.slots - freePlaces(geometry, layout, index, covered, "all").length;
    return `Shelf ${index + 1}: ${free} free places${taken > 0 ? ` (${taken} taken by POSM${posm.length ? `: ${posm.join(", ")}` : ""})` : ""}`;
  });
  const now = geometry.shelves.map((shelf, index) => {
    const row: string[] = [];
    for (let p = 0; p < shelf.slots; p++) {
      const cell = layout[slotKey(index, p)];
      if (cell?.kind !== "SKU") continue;
      const c = code.get(cell.skuId) ?? "?";
      const last = row.at(-1);
      if (last?.startsWith(`${c} ×`))
        row[row.length - 1] = `${c} ×${Number(last.split("×")[1]) + 1}`;
      else row.push(`${c} ×1`);
    }
    return `Shelf ${index + 1}: ${row.join(", ") || "—"}`;
  });
  const catalog = skus.map((s) =>
    [s.code, s.brand, s.name, s.isMandatory ? "mandatory" : "", s.isNew ? "new" : ""]
      .filter(Boolean)
      .join(" | "),
  );
  return [
    mode === "free"
      ? "Mode: fill only the free places. The packs already on the unit stay where they are; for each shelf, list only the packs for its free places."
      : "Mode: arrange the whole unit again. Every place except POSM is free; the current layout is only a reference.",
    `The unit: ${geometry.shelves.length} shelves.`,
    ...shelves,
    "",
    `Brand order: ${(input.brandOrder ?? DEFAULT_BRAND_ORDER).join(", ")}`,
    "",
    "Current layout (code ×facings, left to right):",
    ...now,
    "",
    "Catalog (code | brand | name | marks):",
    ...catalog,
    "",
    `Request:\n"""\n${request}\n"""`,
  ].join("\n");
}

// The places of a shelf an SKU can take: inside the shelf, not a POSM and not under one; in
// «free» mode also not a pack or a place marked empty.
function freePlaces(
  geometry: Geometry,
  layout: Layout,
  shelf: number,
  covered: Set<string>,
  mode: AiLayoutMode,
) {
  const out: string[] = [];
  for (let p = 0; p < (geometry.shelves[shelf]?.slots ?? 0); p++) {
    const key = slotKey(shelf, p);
    if (covered.has(key) || layout[key]?.kind === "POSM") continue;
    if (mode === "free" && layout[key]) continue;
    out.push(key);
  }
  return out;
}

// The model's answer as a layout: what the mode keeps, SKUs in the free places of their shelf left
// to right, what doesn't fit or isn't in the catalog reported. Places left over stay undecided:
// marking them «пусто» would hide the gap from the rule check.
export function layoutFromAnswer(
  answer: AiLayoutAnswer,
  geometry: Geometry,
  current: Layout,
  skus: (SkuInfo & { id: string })[],
  mode: AiLayoutMode = "all",
) {
  const byCode = new Map(skus.map((s) => [s.code.trim().toLowerCase(), s]));
  // A pack keeps the marks it had (e.g. «1mg» set by hand); a new one gets its defaults.
  const badges = new Map<string, string[]>();
  for (const cell of Object.values(current))
    if (cell.kind === "SKU" && !badges.has(cell.skuId)) badges.set(cell.skuId, cell.badges);
  const covered = coveredSlots(current);

  const layout: Layout = {};
  for (const [key, cell] of Object.entries(current))
    if (cell.kind === "POSM" || mode === "free") layout[key] = cell;
  const unknown = new Set<string>();
  const overflow = new Set<string>();
  geometry.shelves.forEach((_, shelf) => {
    const free = freePlaces(geometry, current, shelf, covered, mode);
    const items = answer.shelves.filter((s) => s.shelf === shelf + 1).flatMap((s) => s.items);
    let next = 0;
    for (const item of items) {
      const sku = byCode.get(item.code.trim().toLowerCase());
      if (!sku) {
        unknown.add(item.code.trim());
        continue;
      }
      const facings = Math.max(1, Math.min(MAX_FACINGS, Math.round(item.facings) || 1));
      for (let i = 0; i < facings; i++) {
        const key = free[next];
        if (!key) {
          overflow.add(sku.name);
          break;
        }
        next++;
        layout[key] = {
          kind: "SKU",
          skuId: sku.id,
          badges: badges.get(sku.id) ?? [
            ...new Set([...(sku.isNew ? ["YANGI"] : []), ...sku.defaultBadges]),
          ],
        };
      }
    }
  });
  return { layout, unknown: [...unknown], overflow: [...overflow] };
}

// The suggestion for a draft the actor may edit, from its layout as it is in the editor now.
export async function suggestLayout(
  actor: Actor,
  planogramId: string,
  current: Layout,
  request: string,
  today: string,
  call?: ModelCall,
  mode: AiLayoutMode = "all",
) {
  if (!canManagePlanograms(actor.role)) throw new PlanogramError("forbidden");
  const text = request.trim().slice(0, MAX_REQUEST);
  if (!text) throw new PlanogramError("invalid");
  const loaded = await loadPlanogram(planogramId);
  if (!loaded) throw new PlanogramError("notFound");
  if (loaded.record.status !== "DRAFT" && loaded.record.status !== "PENDING_APPROVAL")
    throw new PlanogramError("notDraft");
  // Delisted packs are not offered; mandatory = this model's own list, else the SKUs marked so.
  const skus = withMandatory(
    (await loadSkuInfos()).filter((s) => !s.archived),
    loaded.record.equipment.mandatorySkuIds,
  );
  const posmIds = Object.values(current).flatMap((c) => (c.kind === "POSM" ? [c.posmId] : []));
  const posms = await db.posm.findMany({
    where: { id: { in: posmIds } },
    select: { id: true, name: true },
  });
  const answer = await runStructured({
    userId: actor.id,
    fn: "suggestLayout",
    system: AI_LAYOUT_SYSTEM,
    prompt: aiLayoutPrompt({
      geometry: loaded.geometry,
      layout: current,
      skus,
      posmNames: new Map(posms.map((p) => [p.id, p.name])),
      request: text,
      mode,
    }),
    schema: aiLayoutSchema,
    today,
    call,
  });
  return {
    ...layoutFromAnswer(answer, loaded.geometry, current, skus, mode),
    note: answer.note.trim().slice(0, 500),
  };
}

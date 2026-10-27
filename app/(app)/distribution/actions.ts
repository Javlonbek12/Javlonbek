"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";
import {
  addCampaignFile,
  createCampaign,
  importReplacement,
  makeList,
  removeCampaignFile,
  saveComposition,
  savePrices,
  setKvFinal,
  setOrdered,
  updateConcept,
} from "@/modules/distribution/campaign";
import { saveEas } from "@/modules/distribution/eas";
import { addPurchase, deletePurchase } from "@/modules/distribution/purchases";
import { importLaunchTemplate } from "@/modules/distribution/template";
import {
  addElement,
  deleteElement,
  importCatalogFile,
  saveElementSizes,
  saveTypeSizes,
} from "@/modules/distribution/catalog";
import {
  addShipment,
  createOrder,
  deleteOrder,
  deletePosm,
  deleteShipment,
  DistributionError,
  importEquipmentFile,
  importOutletBase,
  importPosmList,
  loadDistribution,
  ORDER_COOKIE,
  resolvePendingImport,
  checkOrder,
  setIncludeStock,
  setOrderClosed,
  shipWaybill,
  updatePosmSettings,
} from "@/modules/distribution/service";

async function rememberOrder(id: string) {
  (await cookies()).set(ORDER_COOKIE, id, { path: "/", sameSite: "lax", httpOnly: true });
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const int = (form: FormData, key: string) => Number(str(form, key));

// Runs an action; the result (or the error code) goes back to the page in the link.
async function run(back: string, action: () => Promise<string>) {
  let target: string;
  try {
    target = await action();
  } catch (error) {
    if (!(error instanceof DistributionError)) throw error;
    // The error goes before the #anchor, if any.
    const [path, hash] = back.split("#");
    target = `${path}${path!.includes("?") ? "&" : "?"}error=${error.code}${hash ? `#${hash}` : ""}`;
  }
  revalidatePath("/distribution", "layout");
  revalidatePath("/equipment", "layout");
  redirect(target);
}

async function upload(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return Buffer.from(await file.arrayBuffer());
}

export async function importEquipmentAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/import", async () => {
    const buffer = await upload(form);
    if (!buffer) throw new DistributionError("badFile");
    const r = await importEquipmentFile(user, buffer);
    if (r.status === "pending") return `/distribution/import?pending=${r.id}`;
    return `/distribution/import?${equipmentQuery(r)}`;
  });
}

const equipmentQuery = (r: {
  rows: number;
  units: number;
  stock: number;
  skipped: number;
  noId: number;
}) =>
  new URLSearchParams({
    equipment: String(r.rows),
    units: String(r.units),
    stock: String(r.stock),
    skipped: String(r.skipped),
    noId: String(r.noId),
  });

// A POSM launch template: «Parameters» into the purchase journal, «BOM Matrix» into the catalog.
export async function importTemplateAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/import", async () => {
    const file = form.get("file");
    const buffer = await upload(form);
    if (!buffer || !(file instanceof File)) throw new DistributionError("badFile");
    const r = await importLaunchTemplate(user, buffer, {
      fileName: file.name,
      date: str(form, "date"),
    });
    const query = new URLSearchParams({
      template: String(r.purchases),
      bought: String(r.bought),
      sizes: String(r.sizes),
      elements: String(r.elements),
      noSize: String(r.skipped.length),
    });
    return `/distribution/import?${query}#template`;
  });
}

// A file whose control table has a minus: saved anyway, or dropped.
export async function resolveImportAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/import", async () => {
    const r = await resolvePendingImport(user, str(form, "id"), str(form, "save") === "1");
    return r ? `/distribution/import?${equipmentQuery(r)}` : "/distribution/import?dropped=1";
  });
}

export async function addPurchaseAction(form: FormData) {
  const user = await requireUser();
  await run("/equipment/control", async () => {
    await addPurchase(user, {
      types: form.getAll("types").map(String),
      quantity: Number(str(form, "quantity").replace(",", ".")),
      date: str(form, "date"),
      document: str(form, "document"),
      note: str(form, "note"),
    });
    return "/equipment/control?added=1";
  });
}

export async function deletePurchaseAction(form: FormData) {
  const user = await requireUser();
  await run("/equipment/control", async () => {
    await deletePurchase(user, str(form, "id"));
    return "/equipment/control";
  });
}

export async function importOutletsAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/import", async () => {
    const buffer = await upload(form);
    if (!buffer) throw new DistributionError("badFile");
    const r = await importOutletBase(user, buffer);
    const query = new URLSearchParams({
      outlets: String(r.outlets),
      withTsm: String(r.withTsm),
      units: String(r.units),
      unitsWithTsm: String(r.unitsWithTsm),
      missing: String(r.missing),
      mismatched: String(r.mismatched),
    });
    return `/distribution/import?${query}`;
  });
}

export async function createOrderAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/campaigns", async () => {
    const order = await createOrder(
      user,
      {
        name: str(form, "name"),
        orderedOn: str(form, "orderedOn"),
        note: str(form, "note"),
        copyFrom: str(form, "copyFrom") || null,
      },
      await upload(form),
    );
    await rememberOrder(order.id);
    return "/distribution/campaigns?created=1";
  });
}

export async function importPosmAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/campaigns", async () => {
    const buffer = await upload(form);
    if (!buffer) throw new DistributionError("badFile");
    const count = await importPosmList(user, str(form, "orderId"), buffer);
    return `/distribution/campaigns?posm=${count}`;
  });
}

export async function pickOrderAction(form: FormData) {
  await requireUser();
  const back = str(form, "back").startsWith("/distribution") ? str(form, "back") : "/distribution";
  await run(back, async () => {
    await checkOrder(str(form, "orderId"));
    await rememberOrder(str(form, "orderId"));
    return back;
  });
}

export async function setOrderClosedAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/campaigns", async () => {
    await setOrderClosed(user, str(form, "orderId"), str(form, "closed") === "1");
    return "/distribution/campaigns";
  });
}

export async function deleteOrderAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/campaigns", async () => {
    await deleteOrder(user, str(form, "orderId"));
    return "/distribution/campaigns?deleted=1";
  });
}

export async function deletePosmAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(`/distribution/posm/${id}`, async () => {
    await deletePosm(user, id);
    return "/distribution/campaigns?posmDeleted=1";
  });
}

export async function setIncludeStockAction(form: FormData) {
  const user = await requireUser();
  await run("/equipment/tables", async () => {
    await setIncludeStock(user, str(form, "includeStock") === "1");
    return "/equipment/tables";
  });
}

export async function updatePosmAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  const back = `/distribution/posm/${id}`;
  await run(back, async () => {
    const norm = str(form, "norm");
    const base = str(form, "base");
    await updatePosmSettings(user, id, {
      inStock: int(form, "inStock"),
      ordered: int(form, "ordered"),
      reservePct: Number(str(form, "reserve") || 0) / 100,
      base: base === "SLOTS" || base === "PLANOGRAM" ? base : "UNITS",
      norm: norm === "" ? null : Number(norm.replace(",", ".")),
      normReserve: Number(str(form, "normReserve") || 0) / 100,
      types: form.getAll("types").map(String),
    });
    return `${back}?saved=1`;
  });
}

export async function addShipmentAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/stock", async () => {
    const { destinations } = await loadDistribution();
    await addShipment(
      user,
      {
        posmId: str(form, "posmId"),
        destination: str(form, "destination"),
        quantity: int(form, "quantity"),
        shippedOn: str(form, "shippedOn"),
        note: str(form, "note"),
      },
      destinations,
    );
    return "/distribution/stock?added=1";
  });
}

export async function shipWaybillAction(form: FormData) {
  const user = await requireUser();
  const destination = str(form, "destination");
  const back = `/distribution/plan/${encodeURIComponent(destination)}`;
  await run(back, async () => {
    const { destinations } = await loadDistribution();
    const ids = form.getAll("posmId").map(String);
    const quantities = form.getAll("quantity").map((q) => Number(q));
    const count = await shipWaybill(
      user,
      destination,
      ids.map((posmId, i) => ({ posmId, quantity: quantities[i] ?? 0 })),
      str(form, "shippedOn"),
      destinations,
    );
    return `${back}?done=${count}`;
  });
}

export async function deleteShipmentAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/stock", async () => {
    await deleteShipment(user, str(form, "id"));
    return "/distribution/stock?deleted=1";
  });
}

// ——— The order builder and its catalog of sizes ———

const optNum = (form: FormData, key: string) => {
  const v = str(form, key).replace(",", ".");
  return v === "" ? null : Number(v);
};

export async function addElementAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/sizes", async () => {
    const element = await addElement(user, str(form, "name"), str(form, "material"));
    return `/distribution/sizes/${element.id}`;
  });
}

export async function saveElementSizesAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(`/distribution/sizes/${id}`, async () => {
    await saveElementSizes(user, id, {
      name: str(form, "name"),
      material: str(form, "material"),
      sizes: form.getAll("type").map((value) => {
        const type = String(value);
        const field = (key: string) => optNum(form, `${key}:${type}`);
        return {
          type,
          heightMm: field("h"),
          widthMm: field("w"),
          perUnit: field("per"),
          price: field("price"),
          material: str(form, `material:${type}`) || null,
          note: str(form, `note:${type}`) || null,
        };
      }),
    });
    return `/distribution/sizes/${id}?saved=1`;
  });
}

export async function deleteElementAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/sizes", async () => {
    await deleteElement(user, str(form, "id"));
    return "/distribution/sizes?deleted=1";
  });
}

export async function saveTypeSizesAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/sizes", async () => {
    await saveTypeSizes(
      user,
      form.getAll("type").map((value) => {
        const type = String(value);
        return {
          type,
          heightMm: optNum(form, `h:${type}`),
          widthMm: optNum(form, `w:${type}`),
          depthMm: optNum(form, `d:${type}`),
          note: str(form, `note:${type}`) || null,
        };
      }),
    );
    return "/distribution/sizes?saved=1";
  });
}

export async function importCatalogAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/sizes", async () => {
    const buffer = await upload(form);
    if (!buffer) throw new DistributionError("badFile");
    const r = await importCatalogFile(user, buffer);
    return `/distribution/sizes?sizes=${r.sizes}&types=${r.types}`;
  });
}

// ——— Campaigns ———

const campaignPath = (id: string, anchor = "") => `/distribution/campaigns/${id}${anchor}`;

export async function createCampaignAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/campaigns", async () => {
    const order = await createCampaign(user, {
      name: str(form, "name"),
      description: str(form, "description"),
      projectId: str(form, "projectId") || null,
    });
    await rememberOrder(order.id);
    return campaignPath(order.id);
  });
}

export async function updateConceptAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(campaignPath(id, "#concept"), async () => {
    await updateConcept(user, id, {
      name: str(form, "name"),
      description: str(form, "description"),
      projectId: str(form, "projectId") || null,
      approved: form.get("approved") === "1",
    });
    return campaignPath(id, "?saved=concept#concept");
  });
}

const FILE_KINDS = ["CONCEPT", "KEY_VISUAL", "QUOTE", "EAS", "OTHER"] as const;

export async function addCampaignFileAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  const kind = FILE_KINDS.find((k) => k === str(form, "kind")) ?? "OTHER";
  const anchor = kind === "KEY_VISUAL" ? "#kv" : kind === "QUOTE" ? "#prices" : "#concept";
  await run(campaignPath(id, anchor), async () => {
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new DistributionError("badFile");
    for (const file of files.slice(0, 10)) await addCampaignFile(user, id, kind, file);
    return campaignPath(id, anchor);
  });
}

export async function removeCampaignFileAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(campaignPath(id), async () => {
    await removeCampaignFile(user, str(form, "fileId"));
    return campaignPath(id, str(form, "anchor"));
  });
}

export async function setKvFinalAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(campaignPath(id, "#kv"), async () => {
    await setKvFinal(user, str(form, "fileId"), str(form, "final") === "1");
    return campaignPath(id, "#kv");
  });
}

// The composition form: el = chosen elements; t:<element> = its types; pu:<element>:<type>.
export async function saveCompositionAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(campaignPath(id, "#composition"), async () => {
    const reserve = Number(str(form, "reserve").replace(",", ".") || 0);
    await saveComposition(user, id, {
      reservePct: reserve / 100,
      withStock: form.get("stock") === "1",
      elements: form.getAll("el").map((value) => {
        const elementId = String(value);
        const perUnit: Record<string, number> = {};
        for (const key of form.keys()) {
          const m = new RegExp(`^pu:${elementId}:(.+)$`).exec(key);
          const v = str(form, key).replace(",", ".");
          if (m && v !== "") perUnit[m[1]!] = Number(v);
        }
        return { elementId, types: form.getAll(`t:${elementId}`).map(String), perUnit };
      }),
    });
    if (str(form, "next") === "list") await makeList(user, id);
    return campaignPath(id, str(form, "next") === "list" ? "?saved=list#list" : "#composition");
  });
}

export async function savePricesAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(campaignPath(id, "#list"), async () => {
    const count = await savePrices(user, id, {
      prices: form.getAll("posmId").map((value) => ({
        posmId: String(value),
        price: optNum(form, `price:${String(value)}`),
      })),
      confirm: form.getAll("confirm").map(String),
      supplier: str(form, "supplier"),
      quoteNo: str(form, "quoteNo"),
      quotedOn: str(form, "quotedOn"),
    });
    return campaignPath(id, `?prices=${count}#list`);
  });
}

export async function setOrderedAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(campaignPath(id, "#order"), async () => {
    await setOrdered(user, id, str(form, "undo") === "1" ? null : str(form, "orderedOn"));
    return campaignPath(id, "#order");
  });
}

export async function openDistributionAction(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  await run(campaignPath(id), async () => {
    await checkOrder(id);
    await rememberOrder(id);
    return str(form, "to") === "stock" ? "/distribution/stock" : "/distribution/plan";
  });
}

export async function importReplacementAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(campaignPath(id, "#replacement"), async () => {
    const buffer = await upload(form);
    if (!buffer) throw new DistributionError("badFile");
    const r = await importReplacement(user, id, buffer);
    const q = new URLSearchParams({
      rows: String(r.rows),
      replaced: String(r.replaced),
      unknown: String(r.unknown),
    });
    return campaignPath(id, `?${q}#replacement`);
  });
}

export async function saveEasAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  const back = `/distribution/campaigns/${id}/eas`;
  await run(back, async () => {
    const amount = (key: string) => {
      const v = str(form, key).replace(/[\s ]/g, "").replace(",", ".");
      return v === "" ? null : Number(v);
    };
    const groups = form.getAll("group").map(String);
    await saveEas(user, id, {
      budgetMonth: str(form, "budgetMonth"),
      budgetCategory: str(form, "budgetCategory"),
      categoryRemark: str(form, "categoryRemark"),
      team: str(form, "team"),
      account: str(form, "account"),
      division: str(form, "division"),
      department: str(form, "department"),
      pic: str(form, "pic"),
      month: str(form, "month"),
      expensesDetails: str(form, "expensesDetails"),
      monthlyBudget: amount("monthlyBudget"),
      alreadySpent: amount("alreadySpent"),
      title: str(form, "title"),
      intro: str(form, "intro"),
      background: str(form, "background"),
      purpose: str(form, "purpose"),
      scope: str(form, "scope"),
      coverage: str(form, "coverage"),
      groupPurpose: Object.fromEntries(groups.map((g, i) => [g, str(form, `groupPurpose:${i}`)])),
      suppliers: [0, 1, 2, 3].map((i) => ({
        name: str(form, `supplier:${i}`),
        legalName: str(form, `legal:${i}`),
        total: amount(`total:${i}`),
      })),
      recommended: str(form, "recommended"),
      recommendedReason: str(form, "recommendedReason"),
      benefits: str(form, "benefits"),
    });
    return `${back}?saved=1`;
  });
}

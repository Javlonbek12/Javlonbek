"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";
import {
  addElement,
  createOrderFromBuilder,
  deleteElement,
  importCatalogFile,
  saveElementSizes,
  saveTypeSizes,
  builderOptions,
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
    target = `${back}${back.includes("?") ? "&" : "?"}error=${error.code}`;
  }
  revalidatePath("/distribution", "layout");
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
    const query = new URLSearchParams({
      equipment: String(r.rows),
      units: String(r.units),
      stock: String(r.stock),
      skipped: String(r.skipped),
    });
    return `/distribution/import?${query}`;
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
    });
    return `/distribution/import?${query}`;
  });
}

export async function createOrderAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/orders", async () => {
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
    return "/distribution/orders?created=1";
  });
}

export async function importPosmAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/orders", async () => {
    const buffer = await upload(form);
    if (!buffer) throw new DistributionError("badFile");
    const count = await importPosmList(user, str(form, "orderId"), buffer);
    return `/distribution/orders?posm=${count}`;
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
  await run("/distribution/orders", async () => {
    await setOrderClosed(user, str(form, "orderId"), str(form, "closed") === "1");
    return "/distribution/orders";
  });
}

export async function deleteOrderAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/orders", async () => {
    await deleteOrder(user, str(form, "orderId"));
    return "/distribution/orders?deleted=1";
  });
}

export async function deletePosmAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await run(`/distribution/posm/${id}`, async () => {
    await deletePosm(user, id);
    return "/distribution/orders?posmDeleted=1";
  });
}

export async function setIncludeStockAction(form: FormData) {
  const user = await requireUser();
  await run("/distribution/equipment", async () => {
    await setIncludeStock(user, str(form, "includeStock") === "1");
    return "/distribution/equipment";
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

export async function createOrderFromBuilderAction(form: FormData) {
  const user = await requireUser();
  const options = builderOptions((key) => form.getAll(key).map(String));
  const query = str(form, "query");
  await run(`/distribution/builder?${query}`, async () => {
    const order = await createOrderFromBuilder(
      user,
      { name: str(form, "name"), orderedOn: str(form, "orderedOn"), note: str(form, "note") },
      options,
    );
    await rememberOrder(order.id);
    return "/distribution/orders?created=1";
  });
}

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

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";
import {
  addShipment,
  deleteShipment,
  DistributionError,
  importDistributionFile,
  loadDistribution,
  setIncludeStock,
  shipWaybill,
  updatePosmSettings,
} from "@/modules/distribution/service";

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

export async function importDistributionAction(form: FormData) {
  const user = await requireUser();
  const file = form.get("file");
  await run("/distribution/import", async () => {
    if (!(file instanceof File) || file.size === 0) throw new DistributionError("badFile");
    const result = await importDistributionFile(user, Buffer.from(await file.arrayBuffer()));
    return `/distribution/import?counts=${result.counts}&posm=${result.posm}`;
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

import { notFound } from "next/navigation";

import { PlanogramErrorNote, SavedNote } from "@/components/planograms/error-note";
import { ImageUpload } from "@/components/planograms/image-upload";
import { SkuForm } from "@/components/planograms/sku-form";
import { Thumb } from "@/components/planograms/thumb";
import { db } from "@/lib/db";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";

export default async function SkuPage({
  params,
  searchParams,
}: PageProps<"/planograms/skus/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, saved } = await searchParams;
  const sku = await db.sku.findUnique({ where: { id } });
  if (!sku) notFound();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Thumb kind="sku" id={sku.id} imagePath={sku.imagePath} color={sku.color} />
        <h2 className="text-lg font-medium">
          {sku.brand} {sku.name}
        </h2>
      </div>
      <PlanogramErrorNote error={error} />
      <SavedNote show={saved} />
      <SkuForm sku={sku} />
      {canManagePlanograms(user.role) && <ImageUpload kind="sku" id={sku.id} />}
    </div>
  );
}

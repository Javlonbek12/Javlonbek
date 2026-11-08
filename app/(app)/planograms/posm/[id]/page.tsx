import { notFound } from "next/navigation";

import { PlanogramErrorNote, SavedNote } from "@/components/planograms/error-note";
import { ImageUpload } from "@/components/planograms/image-upload";
import { PosmForm } from "@/components/planograms/posm-form";
import { Thumb } from "@/components/planograms/thumb";
import { db } from "@/lib/db";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { posmInUse } from "@/modules/planograms/library";

export default async function PosmEditPage({
  params,
  searchParams,
}: PageProps<"/planograms/posm/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, saved } = await searchParams;
  const posm = await db.posm.findUnique({ where: { id } });
  if (!posm) notFound();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Thumb kind="posm" id={posm.id} imagePath={posm.imagePath} color={posm.color} />
        <h2 className="text-lg font-medium">{posm.name}</h2>
      </div>
      <PlanogramErrorNote error={error} />
      <SavedNote show={saved} />
      <PosmForm posm={posm} inUse={await posmInUse(posm.id)} />
      {canManagePlanograms(user.role) && <ImageUpload kind="posm" id={posm.id} />}
    </div>
  );
}

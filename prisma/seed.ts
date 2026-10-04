import "dotenv/config";

import { db } from "@/lib/db";
import { seedPlanogramLibrary } from "@/modules/planograms/seed-library";
import { approvePlanogram, createPlanogram } from "@/modules/planograms/service";

async function main() {
  await seedPlanogramLibrary();

  // Demo planograms need a real user (the OWNER) as their author.
  const owner = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) {
    console.log(
      "Seed: library ready. Log in once (you become OWNER) and run `npm run db:seed` again for demo planograms.",
    );
    return;
  }
  if ((await db.planogram.count()) === 0) {
    const equipment = (code: string) => db.equipment.findUniqueOrThrow({ where: { code } });
    const meta = {
      channel: "POSI",
      project: "Тестовый проект",
      validFrom: null,
      validTo: null,
      priceListId: null,
      notes: null,
    };
    const pog = await createPlanogram(owner, {
      ...meta,
      title: "POG MINI POSI",
      equipmentId: (await equipment("POG_MINI")).id,
      fill: "auto",
    });
    await approvePlanogram(owner, pog.id);
    await createPlanogram(owner, {
      ...meta,
      title: "Display L POSI",
      equipmentId: (await equipment("DISPLAY_L")).id,
      fill: "auto",
    });
    await createPlanogram(owner, {
      ...meta,
      channel: "DG",
      title: "LEGO 21 DG",
      equipmentId: (await equipment("LEGO_21")).id,
      fill: "empty",
    });
  }
  console.log("Seed: equipment, 18 test SKUs, POSM, price list and demo planograms are ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

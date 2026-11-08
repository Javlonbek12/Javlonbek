import Link from "next/link";
import { redirect } from "next/navigation";

import { OrgImportForm } from "@/components/org/org-import-form";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";
import { canEditOrg } from "@/modules/org/service";

// The owner loads the whole org chart from an Excel file (the template is on the page).
export default async function OrgImportPage() {
  const user = await requireModule("structure");
  if (!canEditOrg(user)) redirect("/team/structure");
  const existing = await db.orgNode.count();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/team/structure" className="text-muted-foreground w-fit text-sm hover:underline">
        ← {t("team.org.title")}
      </Link>
      <h1 className="text-[22px] font-medium md:text-2xl">{t("team.org.import.title")}</h1>
      <ol className="text-muted-foreground list-decimal pl-5 text-sm">
        <li>{t("team.org.import.step1")}</li>
        <li>{t("team.org.import.step2")}</li>
        <li>{t("team.org.import.step3")}</li>
      </ol>
      <Card>
        <OrgImportForm replaces={existing > 0} />
      </Card>
    </div>
  );
}

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";

// What a page shows before the first file is uploaded (or when the upload on screen cannot be
// counted): where to upload and where to read how S&OP is run.
export function SopEmpty({ broken = false }: { broken?: boolean }) {
  return (
    <Card className="max-w-2xl gap-3">
      <CardTitle>{t("sop.empty.title")}</CardTitle>
      <CardDescription>{broken ? t("sop.broken") : t("sop.empty.text")}</CardDescription>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/sop/uploads">{t("sop.empty.upload")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sop/guide">{t("sop.empty.guide")}</Link>
        </Button>
      </div>
    </Card>
  );
}

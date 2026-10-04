import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";

// Plain multipart form: posts to the image route, which redirects back here.
export function ImageUpload({ kind, id }: { kind: "sku" | "posm"; id: string }) {
  return (
    <form
      action={`/api/planogram-images/${kind}/${id}`}
      method="post"
      encType="multipart/form-data"
      className="flex flex-wrap items-end gap-2"
    >
      <Label className="flex-col items-start">
        {t("planograms.library.skus.image")}
        <Input type="file" name="file" accept="image/png,image/jpeg,image/webp" required />
      </Label>
      <Button type="submit" variant="outline" size="sm">
        {t("planograms.library.skus.upload")}
      </Button>
    </form>
  );
}

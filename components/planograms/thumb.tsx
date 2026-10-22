import { t } from "@/lib/i18n";

// Small pack / POSM picture, or a coloured placeholder when there is none.
export function Thumb({
  kind,
  id,
  imagePath,
  color,
}: {
  kind: "sku" | "posm";
  id: string;
  imagePath: string | null;
  color: string;
}) {
  if (!imagePath) {
    return (
      <span
        className="block h-10 w-7 shrink-0 rounded-sm border"
        style={{ background: color }}
        title={t("planograms.library.noImage")}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- private, auth-protected image route
    <img
      src={`/api/planogram-images/${kind}/${id}?h=96&v=${encodeURIComponent(imagePath)}`}
      alt=""
      className="h-10 w-7 shrink-0 rounded-sm border object-contain"
    />
  );
}

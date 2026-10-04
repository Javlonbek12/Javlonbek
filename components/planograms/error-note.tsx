import { t, type TranslationKey } from "@/lib/i18n";

export function PlanogramErrorNote({ error }: { error: unknown }) {
  if (typeof error !== "string") return null;
  return (
    <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
      {t(`planograms.errors.${error}` as TranslationKey)}
    </p>
  );
}

export function SavedNote({ show, text }: { show: unknown; text?: string }) {
  if (!show) return null;
  return (
    <p role="status" className="bg-secondary rounded-md p-3 text-sm">
      {text ?? t("planograms.actions.saved")}
    </p>
  );
}

import { t, type TranslationKey } from "@/lib/i18n";
import { ru } from "@/lib/i18n/ru";

export function LoginError({ error }: { error?: string }) {
  if (!error || !(error in ru.login.errors)) return null;
  return (
    <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
      {t(`login.errors.${error}` as TranslationKey)}
    </p>
  );
}

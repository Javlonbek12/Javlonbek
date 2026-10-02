import { t } from "@/lib/i18n";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center md:max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("home.title")}</h1>
      <p className="text-muted-foreground text-base">{t("home.subtitle")}</p>
    </main>
  );
}

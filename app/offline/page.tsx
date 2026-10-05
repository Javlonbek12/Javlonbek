import { t } from "@/lib/i18n";

// Shown by the service worker when there is no network and the page is not cached.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("offline.title")}</h1>
      <p className="text-muted-foreground">{t("offline.message")}</p>
    </main>
  );
}

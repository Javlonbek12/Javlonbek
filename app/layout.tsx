import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { LocaleProvider } from "@/components/locale-provider";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getViewerLocale } from "@/modules/core/auth/current-user";

import "@fontsource-variable/onest";
import "./globals.css";

export const metadata: Metadata = {
  title: t("app.name"),
  description: t("app.description"),
  applicationName: t("app.name"),
  appleWebApp: { capable: true, title: t("app.name"), statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f8fc",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getViewerLocale();
  // Light or dark, as chosen with the button in the top bar (kept in a cookie: no flash on load).
  const dark = (await cookies()).get("theme")?.value === "dark";
  return (
    <html lang={locale} className={cn("h-full antialiased", dark && "dark")}>
      <body className="flex min-h-full flex-col font-sans">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { LocaleProvider } from "@/components/locale-provider";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { t } from "@/lib/i18n";
import { DARK_QUERY, readTheme, STATUS_BAR, SYSTEM_THEME_SCRIPT, THEME_COOKIE } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { getViewerLocale } from "@/modules/core/auth/current-user";

import "@fontsource-variable/onest";
import "./globals.css";

export const metadata: Metadata = {
  // A page's own title reads «Команда — Assistant» (sections get theirs from DocumentTitle).
  title: { default: t("app.name"), template: `%s — ${t("app.name")}` },
  description: t("app.description"),
  applicationName: t("app.name"),
  appleWebApp: { capable: true, title: t("app.name"), statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

const theme = async () => readTheme((await cookies()).get(THEME_COOKIE)?.value);

// The phone's status bar follows the chosen theme; with "как в телефоне", the phone's own.
export async function generateViewport(): Promise<Viewport> {
  const chosen = await theme();
  return {
    width: "device-width",
    initialScale: 1,
    themeColor:
      chosen === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: STATUS_BAR.light },
            { media: DARK_QUERY, color: STATUS_BAR.dark },
          ]
        : STATUS_BAR[chosen],
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getViewerLocale();
  // Light, dark or as on the phone, as chosen with the button in the top bar (kept in a cookie: no
  // flash on load). "System" is resolved by the script before the first paint, hence
  // suppressHydrationWarning on <html>.
  const chosen = await theme();
  return (
    <html
      lang={locale}
      data-theme={chosen}
      className={cn("h-full antialiased", chosen === "dark" && "dark")}
      suppressHydrationWarning
    >
      <head>
        {chosen === "system" && (
          <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
        )}
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

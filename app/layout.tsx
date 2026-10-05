import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { t } from "@/lib/i18n";

import "@fontsource-variable/onest";
import "@fontsource/unbounded/500.css";
import "@fontsource/unbounded/600.css";
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
  themeColor: "#1c2244",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

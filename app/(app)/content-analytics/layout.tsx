import { requireModule } from "@/modules/core/access/guard";

export default async function ContentAnalyticsLayout({
  children,
}: LayoutProps<"/content-analytics">) {
  await requireModule("content");
  return children;
}

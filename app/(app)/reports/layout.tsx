import { requireModule } from "@/modules/core/access/guard";

export default async function ReportsLayout({ children }: LayoutProps<"/reports">) {
  await requireModule("reports");
  return children;
}

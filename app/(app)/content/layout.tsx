import { requireModule } from "@/modules/core/access/guard";

export default async function ContentLayout({ children }: LayoutProps<"/content">) {
  await requireModule("content");
  return children;
}

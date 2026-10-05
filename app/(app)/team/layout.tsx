import { requireModule } from "@/modules/core/access/guard";

// The team list, the org chart and employee cards; each page narrows further.
export default async function TeamLayout({ children }: LayoutProps<"/team">) {
  await requireModule("team", "structure");
  return children;
}

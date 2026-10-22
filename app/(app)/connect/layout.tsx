import { requireModule } from "@/modules/core/access/guard";

export default async function ConnectLayout({ children }: LayoutProps<"/connect">) {
  await requireModule("connect");
  return children;
}

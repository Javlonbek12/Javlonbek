import { requireModule } from "@/modules/core/access/guard";

export default async function MeetingsLayout({ children }: LayoutProps<"/meetings">) {
  await requireModule("meetings");
  return children;
}

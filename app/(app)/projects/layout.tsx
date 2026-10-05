import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";
import { canOpenProjects } from "@/modules/projects/service";

export default async function ProjectsLayout({ children }: LayoutProps<"/projects">) {
  if (!(await canOpenProjects(await requireUser()))) redirect("/");
  return children;
}

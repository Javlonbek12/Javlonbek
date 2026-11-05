import { TaskTabs } from "@/components/tasks/task-tabs";
import { requireUser } from "@/modules/core/auth/current-user";
import { countDecisions } from "@/modules/tasks/service";

export default async function TasksLayout({ children }: LayoutProps<"/tasks">) {
  const user = await requireUser();
  // «Ждут решения» in the tabs carries how many tasks wait for the user's decision.
  const decisions = await countDecisions(user);
  return (
    <div className="flex flex-col gap-4">
      <TaskTabs decisions={decisions} />
      {children}
    </div>
  );
}

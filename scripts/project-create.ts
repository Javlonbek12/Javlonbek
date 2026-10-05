// Creates a project from a template on the server, as the owner. JSON on stdin:
// { "name": "...", "template": "launch", "anchorDate": "2026-12-28", "team": "...", "lead": "<name or @username>" }
// On the server: GitHub → Actions → Server → project-create.
import "dotenv/config";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { matchUser } from "@/modules/org/match";
import { createProject } from "@/modules/projects/service";

async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const input = JSON.parse(text) as Record<string, string | undefined>;
  const owner = await db.user.findFirst({
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("No owner yet.");
  let leadId: string | null = null;
  if (input.lead) {
    const users = await db.user.findMany();
    leadId = input.lead.startsWith("@")
      ? (users.find((u) => u.telegramUsername?.toLowerCase() === input.lead!.slice(1).toLowerCase())
          ?.id ?? null)
      : matchUser(input.lead, users);
    if (!leadId) throw new Error(`No single app user "${input.lead}".`);
  }
  const project = await createProject(await withAccess(owner), {
    name: input.name ?? "",
    template: input.template,
    anchorDate: input.anchorDate,
    team: input.team,
    description: input.description,
    leadId,
  });
  const tasks = await db.task.count({ where: { project: project.name } });
  console.log(
    `Project created: ${project.name} (template ${project.template ?? "none"}), tasks ${tasks}.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

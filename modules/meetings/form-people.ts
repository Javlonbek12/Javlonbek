import { db } from "@/lib/db";
import type { Actor } from "@/modules/core/permissions";
import { activeOr } from "@/modules/core/users/active";
import { personName } from "@/modules/core/users/display-name";
import { distinctNames } from "@/modules/tasks/names";

// People for the meeting form: active ones (plus `keep`, those already in the meeting), two with
// one name told apart by position, and «Моя команда» — the person's own people (they lead) or,
// for someone with a manager, that manager and the colleagues under them.
export async function meetingFormPeople(actor: Actor, keep: string[] = []) {
  const users = await db.user.findMany({
    where: activeOr(keep),
    select: {
      id: true,
      firstName: true,
      lastName: true,
      position: true,
      managerId: true,
      deactivatedAt: true,
    },
    orderBy: { firstName: "asc" },
  });
  const names = distinctNames(users);
  const me = users.find((u) => u.id === actor.id);
  const teamIds = users
    .filter(
      (u) =>
        u.id !== actor.id &&
        !u.deactivatedAt &&
        (u.managerId === actor.id ||
          (me?.managerId && (u.id === me.managerId || u.managerId === me.managerId))),
    )
    .map((u) => u.id);
  return {
    people: users.map((u) => ({
      id: u.id,
      name: u.deactivatedAt ? personName(u) : names.get(u.id)!,
    })),
    teamIds,
  };
}

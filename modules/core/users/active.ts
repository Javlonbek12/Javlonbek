// A deactivated person (Team → employee card → «Отключить сотрудника») can't sign in, gets no
// messages and drops out of every people picker; their history stays, shown by name.
export const ACTIVE_USER = { deactivatedAt: null } as const;

export const isActiveUser = (user: { deactivatedAt: Date | null }) => user.deactivatedAt === null;

// Active people, plus the ones already chosen (so a form that shows them keeps them).
export const activeOr = (keep: (string | null | undefined)[] = []) => {
  const ids = keep.filter((id): id is string => Boolean(id));
  return ids.length ? { OR: [ACTIVE_USER, { id: { in: ids } }] } : ACTIVE_USER;
};

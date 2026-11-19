// What the search returns: shared by the server (service.ts) and the top bar (components/search).

export const SEARCH_GROUPS = [
  "navigation",
  "people",
  "responsibilities",
  "tasks",
  "meetings",
  "projects",
  "content",
  "planograms",
] as const;
export type SearchGroupKey = (typeof SEARCH_GROUPS)[number];

export type SearchHit = {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  // What it is: picks the icon. A section carries its registry id in `module`.
  kind:
    | "section"
    | "action"
    | "person"
    | "responsibility"
    | "task"
    | "meeting"
    | "project"
    | "content"
    | "planogram";
  module?: string;
  // The last row of a long list: «Все задачи со словами …».
  more?: boolean;
};

export type SearchGroup = { key: SearchGroupKey; hits: SearchHit[] };

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;

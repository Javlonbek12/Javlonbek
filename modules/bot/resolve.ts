import type { ExtractedTask } from "@/modules/ai/prompts";

import type { DraftTask } from "./draft-card";
import { matchPerson } from "./match";

type Person = {
  id: string;
  firstName: string;
  lastName: string | null;
  telegramUsername: string | null;
};

// Turns names said by the user into team members; unknown or ambiguous names stay
// "unresolved" so the card asks who is meant.
export function resolveTasks(
  extracted: ExtractedTask[],
  people: Person[],
  speakerId: string,
): DraftTask[] {
  return extracted.map((task) => {
    const base = {
      title: task.title,
      // Personal only for one's own task.
      personal: task.personal === true,
      dueDate: task.dueDate,
      priority: task.priority,
      project: task.project,
      saidName: task.assigneeName,
    };
    if (!task.assigneeName)
      return { ...base, assigneeId: null, unresolved: false, candidateIds: [] };
    const match = matchPerson(task.assigneeName, people);
    if (match.status === "matched") {
      return {
        ...base,
        assigneeId: match.user.id === speakerId ? null : match.user.id,
        unresolved: false,
        candidateIds: [],
      };
    }
    return {
      ...base,
      assigneeId: null,
      unresolved: true,
      candidateIds: match.status === "ambiguous" ? match.candidates.map((c) => c.id) : [],
    };
  });
}

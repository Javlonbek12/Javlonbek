export type Edge = { blockerId: string; blockedId: string };

// All tasks reachable from `start` following edges in one direction.
function reachable(edges: Edge[], start: string, direction: "up" | "down"): Set<string> {
  const next = new Map<string, string[]>();
  for (const { blockerId, blockedId } of edges) {
    const [from, to] = direction === "down" ? [blockerId, blockedId] : [blockedId, blockerId];
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    for (const id of next.get(stack.pop()!) ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        stack.push(id);
      }
    }
  }
  seen.delete(start);
  return seen;
}

// Adding "blocker blocks blocked" must not create a loop (A waits for B waits for A).
export function wouldCreateCycle(edges: Edge[], blockerId: string, blockedId: string): boolean {
  if (blockerId === blockedId) return true;
  return reachable(edges, blockedId, "down").has(blockerId);
}

// The whole chain around a task: everything it waits for and everything waiting for it.
export function dependencyChain(edges: Edge[], taskId: string) {
  return {
    upstream: reachable(edges, taskId, "up"),
    downstream: reachable(edges, taskId, "down"),
  };
}

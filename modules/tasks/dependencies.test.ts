import { describe, expect, it } from "vitest";

import { dependencyChain, wouldCreateCycle } from "./dependencies";

// a blocks b, b blocks c
const edges = [
  { blockerId: "a", blockedId: "b" },
  { blockerId: "b", blockedId: "c" },
];

describe("wouldCreateCycle", () => {
  it("detects direct and indirect loops", () => {
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "b", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
  });

  it("allows edges that keep the graph acyclic", () => {
    expect(wouldCreateCycle(edges, "a", "c")).toBe(false);
    expect(wouldCreateCycle(edges, "d", "a")).toBe(false);
  });
});

describe("dependencyChain", () => {
  it("returns everything upstream and downstream", () => {
    expect([...dependencyChain(edges, "b").upstream]).toEqual(["a"]);
    expect([...dependencyChain(edges, "b").downstream]).toEqual(["c"]);
    expect([...dependencyChain(edges, "c").upstream].sort()).toEqual(["a", "b"]);
  });
});

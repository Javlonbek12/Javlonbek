import { describe, expect, it } from "vitest";

import {
  DEFAULT_RULES,
  isDefaultRules,
  parseRules,
  readRules,
  RULE_FIELDS,
  ruleValue,
} from "./rules";

const field = (key: string) => RULE_FIELDS.find((f) => f.key === key)!;

describe("«Нормы»: the lines the Connect analytics is counted against", () => {
  it("a field takes a whole number within its limits, typed or saved", () => {
    expect(ruleValue(field("hitRate"), "60")).toBe(60);
    expect(ruleValue(field("hitRate"), " 60 ")).toBe(60);
    expect(ruleValue(field("hitRate"), 60)).toBe(60);
    expect(ruleValue(field("hitRate"), "100")).toBe(100);
    // A target of 0% would be met by everyone; a line of 0% switches a reason off.
    expect(ruleValue(field("hitRate"), "0")).toBeNull();
    expect(ruleValue(field("connect"), "0")).toBe(0);
    for (const bad of ["", "abc", "60.5", "60,5", "-5", "101", "1e2", null, undefined, {}])
      expect(ruleValue(field("hitRate"), bad)).toBeNull();
    // Orders with nothing sold: at least one.
    expect(ruleValue(field("unsold"), "0")).toBeNull();
    expect(ruleValue(field("unsold"), "5")).toBe(5);
    expect(ruleValue(field("unsold"), "100")).toBeNull();
  });

  it("what is saved is read field by field: anything missing or wrong is the standard", () => {
    expect(parseRules(null)).toEqual(DEFAULT_RULES);
    expect(parseRules("x")).toEqual(DEFAULT_RULES);
    expect(parseRules({ hitRate: 60, visited: 250, extra: 1 })).toEqual({
      ...DEFAULT_RULES,
      hitRate: 60,
    });
    expect(isDefaultRules(parseRules({}))).toBe(true);
    expect(isDefaultRules(parseRules({ hitRate: 60 }))).toBe(false);
  });

  it("a form saves nothing with a wrong field and names every one of them", () => {
    const form = Object.fromEntries(RULE_FIELDS.map((f) => [f.key, String(DEFAULT_RULES[f.key])]));
    expect(readRules({ ...form, hitRate: "60", unsold: "5" })).toEqual({
      rules: { ...DEFAULT_RULES, hitRate: 60, unsold: 5 },
      invalid: null,
    });
    expect(readRules({ ...form, hitRate: "many", unsold: "" })).toEqual({
      rules: null,
      invalid: ["hitRate", "unsold"],
    });
    // A field left out of the form is wrong too, not silently the standard.
    expect(readRules({ hitRate: "60" }).invalid).toHaveLength(RULE_FIELDS.length - 1);
  });
});

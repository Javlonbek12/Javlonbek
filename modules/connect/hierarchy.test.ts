import { describe, expect, it } from "vitest";

import {
  buildHierarchy,
  codesUnder,
  flattenTree,
  linkedPositionCodes,
  managerTree,
  ownerOf,
  subtree,
} from "./hierarchy";
import { detectFormat, parseRow, titleKey, type PositionRecord } from "./parse";
import { leadScope, scopeConnectQuery, parseConnectQuery } from "./report";
import { aggregateRows, type TsmRow } from "./visits";

// Synthetic data only: positions «BDM 99», «BUM TEST», TSM_TST_* codes, «Тест …» people.

let nextId = 1;
const position = (
  title: string,
  manager: string | null,
  extra: Partial<PositionRecord> = {},
): PositionRecord => ({
  id: String(nextId++),
  storeCode: "",
  storeName: "",
  city: null,
  channel: null,
  at: "",
  day: "",
  month: "",
  person: null,
  title,
  user: `Тест ${title}`,
  zones: [],
  roles: [],
  manager,
  created: null,
  status: "Активный",
  ...extra,
});

// Chief TEST → BUM TEST (no row of its own) → BDM 99 → TSM_TST_1, TSM_TST_2; Senior TEST → TSM_TST_3.
const sample = () => [
  position("BDM 99", "bum_test", { roles: ["KT&G BDM"], zones: ["TSM_TST_1", "TSM_TST_2"] }),
  position("TSM_TST_1", "BDM 99", { roles: ["Мерчендайзер"] }),
  position("TSM_TST_2", "bdm  99", { roles: ["Мерчендайзер"] }),
  position("Senior TEST", "BUM TEST", { roles: ["KT&G BDM"], zones: ["TSM_TST_9"] }),
  position("TSM_TST_3", "Senior Test", { roles: ["Мерчендайзер"] }),
  position("Supervisor 1 (Тест дистрибьютор)", "Director (Тест дистрибьютор)", {
    roles: ["Супервайзер"],
  }),
];

const row = (code: string, extra: Partial<TsmRow> = {}): TsmRow =>
  ({
    code,
    name: `Тест ${code}`,
    zone: null,
    region: null,
    planned: 10,
    visited: 8,
    visitedRate: 80,
    notVisited: 2,
    unplanned: 0,
    withMv: 6,
    withMvRate: 75,
    withOos: 4,
    withOosRate: 50,
    withConnect: 6,
    connectRate: 75,
    inTime: 3,
    inTimeRate: 50,
    otherEmployee: 0,
    closed: 0,
    attention: 1,
    mvWithoutVisit: 0,
    mvUnique: 6,
    mvFull: 3,
    mvOpen: 6,
    mvFullRate: 50,
    problems: 0,
    oosChecked: 4,
    oosFound: 2,
    orders: 2,
    packs: 30,
    sum: 100000,
    statuses: [],
    sales: {
      orders: 2,
      checked: 2,
      notClosed: 0,
      anySold: 1,
      allSold: 0,
      lines: 4,
      linesSold: 1,
      packsOrdered: 30,
      packsSold: 10,
      packsSoldRaw: 20,
    },
    salesRate: 50,
    ...extra,
  }) as TsmRow;

describe("Employee info", () => {
  it("is recognised by its columns; zones and roles are comma lists", () => {
    const headers = [
      "ИД",
      "Название",
      "Пользователь",
      "Рабочие зоны",
      "Роли",
      "Руководитель",
      "Дата создания",
      "Статус",
    ];
    expect(detectFormat(headers)).toBe("SU_POSITION");
    expect(
      parseRow("SU_POSITION", headers, [
        900001,
        "BDM 99",
        "Тест Руководитель",
        "TSM_TST_1, TSM_TST_2",
        "KT&G BDM, Супервайзер",
        "BUM TEST",
        "04.08.2026 14:26:03",
        "Активный",
      ])?.record,
    ).toMatchObject({
      id: "900001",
      title: "BDM 99",
      user: "Тест Руководитель",
      zones: ["TSM_TST_1", "TSM_TST_2"],
      roles: ["KT&G BDM", "Супервайзер"],
      manager: "BUM TEST",
      created: "2026-08-04T14:26",
    });
    // A row without a title is not a position.
    expect(parseRow("SU_POSITION", headers, [1, null, "Тест", null, null, null, null, null])).toBe(
      null,
    );
  });
});

describe("The hierarchy", () => {
  it("compares titles without case, repeated spaces or «_»; a missing manager is a node", () => {
    expect(titleKey("Senior Test")).toBe(titleKey("Senior  TEST"));
    expect(titleKey("BUM_TEST")).toBe(titleKey("bum test"));
    const h = buildHierarchy(sample());
    const bum = h.nodes.get("bum test")!;
    // Named by the first position that points at it; it has no person.
    expect(bum).toMatchObject({ title: "bum_test", positions: [], parent: null, depth: 0 });
    expect(bum.children.map((k) => h.nodes.get(k)!.title)).toEqual(["BDM 99", "Senior TEST"]);
    expect(h.nodes.get("bdm 99")!.children).toEqual(["tsm tst 1", "tsm tst 2"]);
    expect(h.nodes.get("tsm tst 3")).toMatchObject({ parent: "senior test", depth: 2 });
    expect(h.roots.map((k) => h.nodes.get(k)!.title)).toEqual([
      "bum_test",
      "Director (Тест дистрибьютор)",
    ]);
    expect(subtree(h, "bdm 99").sort()).toEqual(["bdm 99", "tsm tst 1", "tsm tst 2"]);
  });

  it("drops the link that closes a cycle, and a position managing itself", () => {
    const h = buildHierarchy([
      position("Тест A", "Тест C"),
      position("Тест B", "Тест A"),
      position("Тест C", "Тест B"),
      position("Тест D", "Тест D"),
    ]);
    // A → C and B → A are kept; C → B would close the circle, so C is a top node.
    expect(h.nodes.get("тест a")!.parent).toBe("тест c");
    expect(h.nodes.get("тест b")!.parent).toBe("тест a");
    expect(h.nodes.get("тест c")!.parent).toBeNull();
    expect(h.nodes.get("тест d")!.parent).toBeNull();
    expect(h.roots).toEqual(["тест c", "тест d"]);
    expect(h.nodes.get("тест b")!.depth).toBe(2);
  });

  it("a TSM code belongs to the position with that title, else to the deepest listing it in zones", () => {
    const h = buildHierarchy([
      ...sample(),
      // The BUM's zones list everything too: the deeper position wins.
      position("BUM TEST", null, { zones: ["TSM_TST_1", "TSM_TST_7", "TSM_TST_9"] }),
    ]);
    expect(ownerOf(h, "TSM_TST_1")).toBe("tsm tst 1");
    expect(ownerOf(h, "tsm_tst_1")).toBe("tsm tst 1");
    expect(ownerOf(h, "TSM_TST_9")).toBe("senior test");
    expect(ownerOf(h, "TSM_TST_7")).toBe("bum test");
    expect(ownerOf(h, "TSM_TST_404")).toBeNull();
    expect(codesUnder(h, ["Senior TEST"]).sort()).toEqual([
      "Senior TEST",
      "TSM_TST_3",
      "TSM_TST_9",
    ]);
    expect(codesUnder(h, ["Нет такой должности"])).toEqual([]);
  });

  it("the managers' tree: numbers summed up the tree, idle positions and codes outside", () => {
    const h = buildHierarchy(sample());
    const rows = [
      row("TSM_TST_1"),
      row("TSM_TST_2", { planned: 20, visited: 10 }),
      row("TSM_TST_3"),
    ];
    const tree = managerTree(h, [...rows, row("TSM_TST_404")], null);
    expect(tree.roots.map((n) => [n.title, n.tsms])).toEqual([["bum_test", 3]]);
    const [bum] = tree.roots;
    expect(bum!.totals).toMatchObject({ planned: 40, visited: 26, visitedRate: 65 });
    expect(bum!.totals).toEqual(aggregateRows(rows));
    expect(bum!.totals!.sales).toMatchObject({ checked: 6, anySold: 3, packsSold: 30 });
    expect(bum!.totals!.salesRate).toBe(50);
    const bdm = bum!.children[0]!;
    expect(bdm).toMatchObject({ title: "BDM 99", tsms: 2, people: [{ name: "Тест BDM 99" }] });
    expect(bdm.children.map((c) => [c.title, c.own.map((r) => r.code)])).toEqual([
      ["TSM_TST_1", ["TSM_TST_1"]],
      ["TSM_TST_2", ["TSM_TST_2"]],
    ]);
    // The distributor's branch has no TSM: at the end, without numbers.
    expect(tree.idle.map((n) => [n.title, n.totals])).toEqual([
      ["Director (Тест дистрибьютор)", null],
    ]);
    expect(flattenTree(tree.idle)).toHaveLength(2);
    expect(tree.outside.map((r) => r.code)).toEqual(["TSM_TST_404"]);
  });

  it("a scoped viewer sees the positions with their TSMs and those linked to them", () => {
    const h = buildHierarchy(sample());
    const scope = new Set(codesUnder(h, ["BDM 99"]));
    const tree = managerTree(h, [row("TSM_TST_1")], scope);
    // BUM TEST stays as the context; the other branches are not shown.
    expect(flattenTree(tree.roots).map((n) => n.title)).toEqual([
      "bum_test",
      "BDM 99",
      "TSM_TST_1",
      "TSM_TST_2",
    ]);
    expect(tree.idle).toEqual([]);
  });
});

describe("Who sees which TSM: people links and positions together", () => {
  const h = buildHierarchy(sample());
  const access = (links: Record<string, string>) => ({ links, hierarchy: h });

  it("a manager: TSMs linked to their team plus every TSM under positions linked to them", () => {
    const manager = { id: "u-lead", role: "MANAGER" as const };
    const team = {
      ...manager,
      access: { taskScope: "team" as const, teamIds: ["u-member"], modules: [] },
    };
    const people = { TSM_TST_3: "u-member", TSM_TST_404: "u-stranger" };
    // Positions: BDM 99 → the manager.
    const scope = leadScope(team, people, access({ "BDM 99": "u-lead" }))!;
    expect([...scope].sort()).toEqual(["BDM 99", "TSM_TST_1", "TSM_TST_2", "TSM_TST_3"]);
    // «All tasks»: every linked TSM and position.
    const all = leadScope(manager, people, access({ "bdm  99": "u-other" }))!;
    expect([...all].sort()).toEqual([
      "BDM 99",
      "TSM_TST_1",
      "TSM_TST_2",
      "TSM_TST_3",
      "TSM_TST_404",
    ]);
    // The owner sees everything; nothing linked to a team member — nothing.
    expect(leadScope({ ...manager, role: "OWNER" }, people, access({}))).toBeNull();
    expect([...leadScope(team, {}, access({ "BDM 99": "u-other" }))!]).toEqual([]);
    expect(linkedPositionCodes(null, { "BDM 99": "u-lead" }, null)).toEqual([]);
  });

  it("an employee linked to a position sees the TSMs under it, their own code first", () => {
    const query = parseConnectQuery({ view: "manager", person: "TSM_TST_2" }, false);
    const mine = scopeConnectQuery(
      query,
      false,
      { TSM_TST_3: "u-1" },
      "u-1",
      access({ "BDM 99": "u-1" }),
    );
    expect(mine.own).toEqual(["TSM_TST_3", "BDM 99", "TSM_TST_1", "TSM_TST_2"]);
    expect(mine.query).toMatchObject({ view: "executor", person: "TSM_TST_2" });
    // Only a position link counts as a link too.
    const other = scopeConnectQuery(query, false, {}, "u-2", access({ "BDM 99": "u-1" }));
    expect(other.own).toEqual([]);
    expect(scopeConnectQuery(query, false, {}, "u-2", access({})).own).toBeNull();
  });
});

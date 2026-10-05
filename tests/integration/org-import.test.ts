import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { importOrgChart, matchUser } from "@/modules/org/import";
import { getOrgTree } from "@/modules/org/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const chart = [
  {
    unit: "Тестовый отдел",
    children: [
      {
        person: "Тестовый директор",
        title: "Тестовый директор отдела",
        children: [
          {
            person: "Тестовый владелец",
            label: "Тестовая команда",
            title: "Тестовый лидер",
            children: [
              { person: "Тестовый сотрудник А", title: "Тестовый координатор" },
              {
                unit: "Тестовая проектная команда",
                title: "Project Team",
                children: [{ person: null, title: "Тестовый ассистент" }],
              },
            ],
          },
        ],
      },
    ],
  },
];

describe("org chart import", () => {
  beforeEach(resetDb);

  it("matches names to app users only when unambiguous", () => {
    const users = [
      { id: "1", firstName: "Азиз", lastName: "Тестов" },
      { id: "2", firstName: "Азиз", lastName: null },
      { id: "3", firstName: "Зарина", lastName: null },
    ];
    expect(matchUser("зарина", users)).toBe("3");
    expect(matchUser("Азиз Тестов", users)).toBe("1");
    expect(matchUser("Азиз", users)).toBeNull();
    expect(matchUser("Никто", users)).toBeNull();
  });

  it("loads the chart in order, links app users, keeps outsiders and vacancies; refuses to overwrite", async () => {
    const owner = await createTestUser("OWNER", { firstName: "Тестовый владелец" });
    await createTestUser("MEMBER", { firstName: "Тестовый сотрудник А" });
    expect(await importOrgChart(chart)).toEqual({ units: 2, people: 3, linked: 2, vacancies: 1 });

    const [root] = await getOrgTree();
    const director = root.children[0];
    expect(director).toMatchObject({ personName: "Тестовый директор", user: null });
    const lead = director.children[0];
    expect(lead).toMatchObject({ label: "Тестовая команда", user: { id: owner.id } });
    expect(lead.children.map((c) => c.user?.name ?? c.name)).toEqual([
      "Тестовый сотрудник А",
      "Тестовая проектная команда",
    ]);
    expect(lead.children[1].children[0]).toMatchObject({ user: null, personName: null });

    await expect(importOrgChart(chart)).rejects.toThrow("not empty");
    await importOrgChart(chart, { replace: true });
    expect(await db.orgNode.count()).toBe(6);
  });
});

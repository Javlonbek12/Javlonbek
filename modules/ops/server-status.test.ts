import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";

import {
  getServerStatus,
  parseCloudStatus,
  serverWarnings,
  summarizeBackups,
  type ServerStatus,
} from "./server-status";

const GB = 1024 ** 3;
const now = new Date("2026-11-08T12:00:00Z");

const status = (patch: Partial<ServerStatus> = {}): ServerStatus => ({
  disk: { total: 193 * GB, free: 150 * GB },
  memory: { total: 11 * GB, available: 8 * GB },
  cores: 4,
  load: [0.3, 0.2, 0.2],
  uptimeSeconds: 86_400,
  version: "7428549 2026-11-08 Merge",
  databaseBytes: 12 * 1024 ** 2,
  backups: {
    latest: {
      stamp: "2026-11-08_0300",
      at: new Date("2026-11-08T03:00:00Z"),
      databaseBytes: 1,
      uploadsBytes: 2,
    },
    count: 1,
    totalBytes: 3,
  },
  cloud: {
    latest: "2026-11-08_0300",
    bytes: 3,
    copies: 1,
    checkedAt: new Date("2026-11-08T03:41:00Z"),
  },
  ...patch,
});

describe("the owner's «Сервер и бэкапы» card", () => {
  it("groups the backup files into copies, newest first", () => {
    const at = (iso: string) => new Date(iso);
    const summary = summarizeBackups([
      { name: "db-2026-11-07_0300.sql.gz", bytes: 10, modifiedAt: at("2026-11-07T03:00:05Z") },
      {
        name: "uploads-2026-11-07_0300.tar.gz",
        bytes: 100,
        modifiedAt: at("2026-11-07T03:00:09Z"),
      },
      { name: "db-2026-11-08_0300.sql.gz", bytes: 12, modifiedAt: at("2026-11-08T03:00:05Z") },
      {
        name: "uploads-2026-11-08_0300.tar.gz",
        bytes: 110,
        modifiedAt: at("2026-11-08T03:00:09Z"),
      },
      { name: "cloud-status.json", bytes: 90, modifiedAt: at("2026-11-08T03:41:00Z") },
      { name: "db-2026-11-08_0300.sql.gz.part", bytes: 5, modifiedAt: at("2026-11-08T03:00:01Z") },
    ]);
    expect(summary).toEqual({
      latest: {
        stamp: "2026-11-08_0300",
        at: at("2026-11-08T03:00:05Z"),
        databaseBytes: 12,
        uploadsBytes: 110,
      },
      count: 2,
      totalBytes: 232,
    });
    expect(summarizeBackups([])).toEqual({ latest: null, count: 0, totalBytes: 0 });
  });

  it("reads the cloud note and ignores anything else", () => {
    expect(
      parseCloudStatus(
        '{"latest":"2026-11-08_0300","bytes":117440512,"copies":2,"checkedAt":"2026-11-08T03:41:00Z"}',
      ),
    ).toEqual({
      latest: "2026-11-08_0300",
      bytes: 117440512,
      copies: 2,
      checkedAt: new Date("2026-11-08T03:41:00Z"),
    });
    expect(parseCloudStatus("not json")).toBeNull();
    expect(parseCloudStatus('{"latest":1}')).toBeNull();
  });

  it("warns about a full disk, low memory, overload and missing or old copies", () => {
    expect(serverWarnings(status(), now)).toEqual([]);
    expect(
      serverWarnings(
        status({
          disk: { total: 100 * GB, free: 10 * GB },
          memory: { total: 10 * GB, available: 0.5 * GB },
          load: [9, 6, 5],
        }),
        now,
      ),
    ).toEqual(["diskHigh", "memoryLow", "cpuHigh"]);
    expect(
      serverWarnings(
        status({
          backups: { latest: null, count: 0, totalBytes: 0 },
          cloud: null,
        }),
        now,
      ),
    ).toEqual(["noBackups", "cloudOff"]);
    const later = new Date("2026-11-09T18:00:00Z");
    expect(serverWarnings(status(), later)).toEqual(["backupStale", "cloudStale"]);
    // Not on the server (no backup folder): nothing to say about backups.
    expect(serverWarnings(status({ backups: null, cloud: null }), now)).toEqual([]);
  });

  describe("reading the server", () => {
    let dir = "";
    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    it("reads the backup folder, the cloud note, memory and the database size", async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), "backups-"));
      await writeFile(path.join(dir, "db-2026-11-08_0300.sql.gz"), "x".repeat(20));
      await writeFile(path.join(dir, "uploads-2026-11-08_0300.tar.gz"), "y".repeat(30));
      await writeFile(
        path.join(dir, "cloud-status.json"),
        '{"latest":"2026-11-08_0300","bytes":50,"copies":1,"checkedAt":"2026-11-08T03:41:00Z"}',
      );
      const night = new Date("2026-11-08T03:00:05Z");
      await utimes(path.join(dir, "db-2026-11-08_0300.sql.gz"), night, night);
      expect(parseEnv({ DATABASE_URL: "x", SERVER_BACKUPS_DIR: dir }).SERVER_BACKUPS_DIR).toBe(dir);

      const result = await getServerStatus(dir);
      expect(result.backups).toMatchObject({
        count: 1,
        totalBytes: 50,
        latest: { stamp: "2026-11-08_0300", databaseBytes: 20, uploadsBytes: 30, at: night },
      });
      expect(result.cloud?.copies).toBe(1);
      expect(result.disk?.total).toBeGreaterThan(0);
      expect(result.memory.total).toBeGreaterThan(result.memory.available);
      expect(result.cores).toBeGreaterThan(0);
      expect(result.databaseBytes).toBeGreaterThan(0);
    });

    it("says nothing about backups where the folder isn't", async () => {
      const result = await getServerStatus(undefined);
      expect(result.backups).toBeNull();
      expect(result.cloud).toBeNull();
    });
  });
});

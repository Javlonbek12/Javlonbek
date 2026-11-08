import { readdir, readFile, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";

// «Сервер и бэкапы» in the OWNER's settings: what `status` in GitHub Actions shows, without going
// there. The app runs in Docker on the server, and a container sees the host's memory, processor
// load and uptime; the backup folder is mounted into it read-only (docker-compose.prod.yml), so
// its disk is the server's disk too.

export type BackupFile = { name: string; bytes: number; modifiedAt: Date };

export type CloudStatus = {
  // Stamp of the newest copy in the cloud (2026-11-08_0300) and its size.
  latest: string;
  bytes: number;
  copies: number;
  // When GitHub Actions last finished the nightly upload.
  checkedAt: Date;
};

export type ServerStatus = {
  disk: { total: number; free: number } | null;
  memory: { total: number; available: number };
  cores: number;
  load: [number, number, number];
  uptimeSeconds: number;
  version: string | null;
  databaseBytes: number | null;
  // null: the folder isn't there (not on the server, e.g. on a developer's computer).
  backups: ReturnType<typeof summarizeBackups> | null;
  cloud: CloudStatus | null;
};

export type ServerWarning =
  "diskHigh" | "memoryLow" | "cpuHigh" | "noBackups" | "backupStale" | "cloudOff" | "cloudStale";

const HOUR = 3_600_000;
// The server's backup runs every night at 03:00, the cloud copy at 03:40 UTC: a day and a bit.
const BACKUP_STALE_HOURS = 26;
const CLOUD_STALE_HOURS = 30;
const DISK_HIGH = 0.85;
const MEMORY_LOW = 0.1;

const STAMP = /^(db|uploads)-(\d{4}-\d{2}-\d{2}_\d{4})\.(sql\.gz|tar\.gz)$/;

export type BackupCopy = { stamp: string; at: Date; databaseBytes: number; uploadsBytes: number };

// The copies in the backup folder: one per stamp, newest first, with the database and files sizes.
export function summarizeBackups(files: BackupFile[]): {
  latest: BackupCopy | null;
  count: number;
  totalBytes: number;
} {
  const byStamp = new Map<string, BackupCopy>();
  for (const file of files) {
    const match = STAMP.exec(file.name);
    if (!match) continue;
    const [, kind, stamp] = match;
    const copy = byStamp.get(stamp) ?? {
      stamp,
      at: file.modifiedAt,
      databaseBytes: 0,
      uploadsBytes: 0,
    };
    if (kind === "db") {
      copy.databaseBytes = file.bytes;
      copy.at = file.modifiedAt;
    } else copy.uploadsBytes = file.bytes;
    byStamp.set(stamp, copy);
  }
  const copies = [...byStamp.values()].sort((a, b) => b.stamp.localeCompare(a.stamp));
  return {
    latest: copies[0] ?? null,
    count: copies.length,
    totalBytes: copies.reduce((sum, c) => sum + c.databaseBytes + c.uploadsBytes, 0),
  };
}

// cloud-status.json, written by scripts/server/cloud.sh after each upload; anything else is ignored.
export function parseCloudStatus(text: string): CloudStatus | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const checkedAt = new Date(String(value.checkedAt));
    if (typeof value.latest !== "string" || Number.isNaN(checkedAt.getTime())) return null;
    return {
      latest: value.latest,
      bytes: Number(value.bytes) || 0,
      copies: Number(value.copies) || 0,
      checkedAt,
    };
  } catch {
    return null;
  }
}

// What needs the owner's attention, most serious first.
export function serverWarnings(status: ServerStatus, now = new Date()): ServerWarning[] {
  const out: ServerWarning[] = [];
  if (status.disk && status.disk.total > 0 && 1 - status.disk.free / status.disk.total >= DISK_HIGH)
    out.push("diskHigh");
  if (status.memory.total > 0 && status.memory.available / status.memory.total < MEMORY_LOW)
    out.push("memoryLow");
  if (status.load[1] > status.cores) out.push("cpuHigh");
  if (status.backups) {
    if (!status.backups.latest) out.push("noBackups");
    else if (now.getTime() - status.backups.latest.at.getTime() > BACKUP_STALE_HOURS * HOUR)
      out.push("backupStale");
    if (!status.cloud) out.push("cloudOff");
    else if (now.getTime() - status.cloud.checkedAt.getTime() > CLOUD_STALE_HOURS * HOUR)
      out.push("cloudStale");
  }
  return out;
}

// MemAvailable is what programs can still get (the cache is given back on demand).
async function memory() {
  try {
    const text = await readFile("/proc/meminfo", "utf8");
    const kb = (key: string) =>
      Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(text)?.[1]) * 1024;
    const total = kb("MemTotal");
    const available = kb("MemAvailable");
    if (total > 0 && available >= 0) return { total, available };
  } catch {
    // Not Linux: fall back to what Node knows.
  }
  return { total: os.totalmem(), available: os.freemem() };
}

async function readBackupFolder(dir: string) {
  const names = await readdir(dir);
  const files: BackupFile[] = [];
  for (const name of names) {
    if (!STAMP.test(name)) continue;
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info?.isFile()) files.push({ name, bytes: info.size, modifiedAt: info.mtime });
  }
  const cloud = await readFile(path.join(dir, "cloud-status.json"), "utf8")
    .then(parseCloudStatus)
    .catch(() => null);
  return { summary: summarizeBackups(files), cloud };
}

export async function getServerStatus(dir = getEnv().SERVER_BACKUPS_DIR): Promise<ServerStatus> {
  const folder = dir ? await readBackupFolder(dir).catch(() => null) : null;
  // The backup folder sits on the server's own disk; without it, the disk the app runs on.
  const disk = await statfs(folder && dir ? dir : "/")
    .then((s) => ({ total: s.blocks * s.bsize, free: s.bavail * s.bsize }))
    .catch(() => null);
  const version = await readFile(path.join(process.cwd(), "REVISION"), "utf8")
    .then((text) => text.trim() || null)
    .catch(() => null);
  const databaseBytes = await db.$queryRaw<
    { bytes: bigint }[]
  >`SELECT pg_database_size(current_database()) AS bytes`
    .then((rows) => Number(rows[0]?.bytes ?? 0))
    .catch(() => null);
  const [one, five, fifteen] = os.loadavg();
  return {
    disk,
    memory: await memory(),
    cores: os.cpus().length || 1,
    load: [one, five, fifteen],
    uptimeSeconds: os.uptime(),
    version,
    databaseBytes,
    backups: folder?.summary ?? null,
    cloud: folder?.cloud ?? null,
  };
}

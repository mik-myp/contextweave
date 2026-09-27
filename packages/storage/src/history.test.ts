import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activityHistoryQuerySchema,
  operationHistoryQuerySchema,
  environmentConfigSchema,
} from "@contextweave/contracts";
import { EnvironmentRepository, openLocalDatabase } from "./index";
import { openVersion4Fixture, legacyFixtureWriter, legacyRows, withoutWorkspaceColumn } from "./legacy-fixture";
import { migrateIntegritySchema } from "./integrity";
import { migrateDatabase, databaseVersion } from "./migrations";

const cleanup: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) fn();
});
function fixture(count = 255) {
  const db = openLocalDatabase(":memory:");
  cleanup.push(db.close);
  const repo = new EnvironmentRepository(db.sqlite);
  repo.create({
    config: environmentConfigSchema.parse({
      environmentId: "env-a",
      name: "ÉCOLE 100%_测试",
      kernelId: "standard-chromium",
      kernelVersion: "local",
      commonConfig: {},
    }),
    platform: "darwin",
    arch: "arm64",
    dataDir: "/fixture-only/profile",
  });
  db.sqlite.exec("BEGIN");
  for (let i = 0; i < count; i++) {
    repo.createRuntimeSession({ workspaceId: repo.workspaceId,
      sessionId: `s-${String(i).padStart(5, "0")}`,
      environmentId: "env-a",
      pid: 42,
      controlPort: 9000,
      // Intentional timestamp ties with unique stable IDs.
      startedAt: `2026-01-${String(1 + Math.floor(i / 100)).padStart(2, "0")}T00:00:00.000Z`,
      status: i % 2 ? "stopped" : "crashed",
      exitReason: i % 3 ? null : "REASON",
      endedAt: i % 2 ? "2026-02-01T00:00:00.000Z" : null,
      revision: i % 2 ? 1 : undefined,
      executableVersion: i % 2 ? "148.0.0.1" : "",
    });
    repo.createOperation(
      `o-${String(i).padStart(5, "0")}`,
      i % 2 ? "start" : "stop",
      i % 2 ? "env-a" : "missing-kernel-key",
    );
  }
  db.sqlite.exec(
    "UPDATE operations SET started_at = '2026-01-01T00:00:00.000Z'; COMMIT",
  );
  return { db, repo };
}

describe("bounded bidirectional history", () => {
  it.each(["activity", "operations"] as const)(
    "visits every tied %s row once in both directions with a hard page cap",
    (domain) => {
      const { repo } = fixture(2500);
      const page = (cursor: string | null) =>
        domain === "activity"
          ? repo.pageActivity({ limit: 73, cursor })
          : repo.pageOperations({ limit: 73, cursor });
      const ids = (items: ReturnType<typeof page>["items"]) =>
        items.map((row) =>
          "sessionId" in row ? row.sessionId : row.operationId,
        );
      const all: string[] = [];
      let current = page(null);
      expect(current.previousCursor).toBeNull();
      const first = ids(current.items);
      while (true) {
        expect(current.items.length).toBeLessThanOrEqual(73);
        all.push(...ids(current.items));
        if (!current.nextCursor) break;
        current = page(current.nextCursor);
      }
      expect(all).toHaveLength(2500);
      expect(new Set(all).size).toBe(2500);
      const backward = ids(current.items);
      while (current.previousCursor) {
        current = page(current.previousCursor);
        backward.unshift(...ids(current.items));
      }
      expect(backward).toEqual(all);
      expect(ids(current.items)).toEqual(first);
      expect(repo.listRuntimeSessions()).toHaveLength(100);
      expect(repo.listOperations()).toHaveLength(100);
      expect(repo.pageActivity().items).toHaveLength(20);
    },
  );

  it("handles all whitelisted sorts, null boundaries and ascending/descending ties", () => {
    const { repo } = fixture(17);
    for (const direction of ["asc", "desc"] as const) {
      for (const sortBy of activityHistoryQuerySchema.shape.sortBy.unwrap()
        .options) {
        const first = repo
          .pageActivity({ sortBy, direction, limit: 100 })
          .items.map((r) => r.sessionId);
        const found: string[] = [];
        let cursor: string | null = null;
        do {
          const page = repo.pageActivity({
            sortBy,
            direction,
            limit: 3,
            cursor,
          });
          found.push(...page.items.map((r) => r.sessionId));
          cursor = page.nextCursor;
        } while (cursor);
        expect(found, `${sortBy}:${direction}`).toEqual(first);
      }
      for (const sortBy of operationHistoryQuerySchema.shape.sortBy.unwrap()
        .options) {
        const expected = repo
          .pageOperations({ sortBy, direction, limit: 100 })
          .items.map((r) => r.operationId);
        const found: string[] = [];
        let cursor: string | null = null;
        do {
          const page = repo.pageOperations({
            sortBy,
            direction,
            limit: 3,
            cursor,
          });
          found.push(...page.items.map((r) => r.operationId));
          cursor = page.nextCursor;
        } while (cursor);
        expect(found, `${sortBy}:${direction}`).toEqual(expected);
      }
    }
  });

  it("filters the entire database, uses literal Unicode search, and preserves rows without an environment", () => {
    const { repo } = fixture();
    expect(
      repo.pageActivity({ search: "s-00001" }).items.map((r) => r.sessionId),
    ).toEqual(["s-00001"]);
    expect(
      repo.pageActivity({
        search: "école 100%_",
        statuses: ["stopped"],
        limit: 100,
      }).items,
    ).toHaveLength(100);
    expect(repo.pageActivity({ search: "%_NOT_A_WILDCARD" }).items).toEqual([]);
    expect(
      repo.pageOperations({ search: "missing-kernel-key" }).items,
    ).toHaveLength(20);
    expect(
      repo
        .pageOperations({ search: "missing-kernel-key" })
        .items.every((r) => !r.environmentName),
    ).toBe(true);
    expect(repo.pageOperations({ statuses: ["failed"] })).toEqual({
      items: [],
      previousCursor: null,
      nextCursor: null,
    });
    const rows = repo.pageActivity({ limit: 1 }).items;
    expect(rows[0]).not.toHaveProperty("pid");
    expect(rows[0]).not.toHaveProperty("processIdentity");
    expect(rows[0]).not.toHaveProperty("controlPort");
  });

  it("does not repeat existing rows when another connection inserts a newer or tied record", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-history-concurrent-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, "history.sqlite");
    const a = openLocalDatabase(path);
    cleanup.push(a.close);
    const b = openLocalDatabase(path);
    cleanup.push(b.close);
    const left = new EnvironmentRepository(a.sqlite),
      right = new EnvironmentRepository(b.sqlite);
    for (const id of ["a", "b", "c", "d"])
      left.createOperation(id, "start", null);
    a.sqlite.exec(
      "UPDATE operations SET started_at = '2026-01-01T00:00:00.000Z'",
    );
    const first = left.pageOperations({ limit: 2 });
    right.createOperation("e", "start", null);
    b.sqlite.exec(
      "UPDATE operations SET started_at = '2026-01-01T00:00:00.000Z' WHERE operation_id = 'e'",
    );
    const second = left.pageOperations({ limit: 2, cursor: first.nextCursor });
    expect([...first.items, ...second.items].map((r) => r.operationId)).toEqual(
      ["d", "c", "b", "a"],
    );
    expect(left.pageOperations({ limit: 2 }).items[0]?.operationId).toBe("e");
    // Anchor lookup starts the read snapshot. A WAL writer between that lookup and
    // page/probe statements must not invent a next-page cursor for this snapshot.
    const prepare = a.sqlite.prepare.bind(a.sqlite);
    let inserted = false;
    const spy = vi.spyOn(a.sqlite, "prepare").mockImplementation((sql) => {
      if (!inserted && sql.includes("SELECT h.*")) {
        inserted = true;
        right.createOperation("0", "start", null);
        b.sqlite.exec(
          "UPDATE operations SET started_at = '2026-01-01T00:00:00.000Z' WHERE operation_id = '0'",
        );
      }
      return prepare(sql);
    });
    const consistent = left.pageOperations({
      limit: 2,
      cursor: first.nextCursor,
    });
    spy.mockRestore();
    expect(inserted).toBe(true);
    expect(consistent.items.map((r) => r.operationId)).toEqual(["b", "a"]);
    expect(consistent.nextCursor).toBeNull();
    expect(left.pageOperations({ limit: 100 }).items.at(-1)?.operationId).toBe(
      "0",
    );
  });

  it("rejects malformed, cross-domain, cross-query and stale cursors without losing the connection", () => {
    const { repo, db } = fixture();
    const cursor = repo.pageActivity({ limit: 2 }).nextCursor!;
    for (const input of [
      { cursor: "not-json", limit: 2 },
      { cursor: Buffer.from("null").toString("base64url"), limit: 2 },
      { cursor, limit: 3 },
      { cursor, limit: 2, search: "different" },
      { cursor, limit: 2, direction: "asc" as const },
      { cursor, limit: 2, statuses: ["running" as const] },
    ])
      expect(() => repo.pageActivity(input)).toThrow("HISTORY_CURSOR_INVALID");
    expect(() => repo.pageOperations({ cursor, limit: 2 })).toThrow(
      "HISTORY_CURSOR_INVALID",
    );
    const anchor = repo.pageActivity({ limit: 2 }).items[1]!;
    repo.deleteRuntimeSession(anchor.sessionId);
    expect(() => repo.pageActivity({ cursor, limit: 2 })).toThrow(
      "HISTORY_CURSOR_STALE",
    );
    expect(db.sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(
      1,
    );
    expect(repo.pageActivity().items).toHaveLength(20);
  });

  it("uses timeline indexes for default and cursor queries, not OFFSET, COUNT or full history materialization", () => {
    const { repo, db } = fixture(1000);
    const prepare = vi.spyOn(db.sqlite, "prepare");
    const first = repo.pageActivity({ limit: 2 });
    repo.pageActivity({ limit: 2, cursor: first.nextCursor });
    repo.pageOperations({ limit: 2 });
    const statements = prepare.mock.calls.map(([sql]) => sql);
    prepare.mockRestore();
    for (const sql of statements.filter((s) => s.includes("ORDER BY"))) {
      expect(sql).toMatch(/LIMIT \?$/);
      expect(sql).not.toMatch(/OFFSET|COUNT\(/i);
      const placeholders = [...sql.matchAll(/\?/g)].length;
      const args =
        placeholders === 1 ? [2] : ["2026-01-01T00:00:00.000Z", "s-00001", 2];
      const plan = db.sqlite
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...args)
        .map((r) => String(r.detail))
        .join("\n");
      expect(plan).toMatch(/idx_(sessions|operations)_timeline/);
      expect(plan).not.toContain("TEMP B-TREE");
    }
  });

  it("returns a genuine empty live page and releases the read transaction on SQL failure", () => {
    const { repo, db } = fixture(7);
    const first = repo.pageActivity({ limit: 2, statuses: ["stopped"] });
    db.sqlite.exec("UPDATE runtime_sessions SET status='crashed'");
    expect(
      repo.pageActivity({
        limit: 2,
        statuses: ["stopped"],
        cursor: first.nextCursor,
      }),
    ).toEqual({ items: [], previousCursor: null, nextCursor: null });
    const prepare = db.sqlite.prepare.bind(db.sqlite);
    const spy = vi.spyOn(db.sqlite, "prepare").mockImplementation((sql) => {
      if (sql.includes("SELECT h.*")) throw new Error("injected read failure");
      return prepare(sql);
    });
    expect(() => repo.pageActivity()).toThrow("injected read failure");
    spy.mockRestore();
    // A leaked transaction would make this independent transaction fail.
    db.sqlite.exec("BEGIN IMMEDIATE; COMMIT");
    expect(repo.pageActivity().items).toHaveLength(7);
  });

  it("keeps complete active-session lookup and finds an older nonempty executable version beyond the UI limit", () => {
    const { repo, db } = fixture(450);
    db.sqlite.exec(
      "UPDATE runtime_sessions SET executable_version = NULL; UPDATE runtime_sessions SET executable_version = '147.0.0.1', status = 'running' WHERE session_id <= 's-00120'",
    );
    expect(repo.listActiveRuntimeSessions()).toHaveLength(121);
    expect(repo.listActiveRuntimeSessions("env-a")).toHaveLength(121);
    expect(repo.listActiveRuntimeSessions("missing")).toEqual([]);
    expect(repo.latestExecutableVersion("env-a")).toBe("147.0.0.1");
    expect(repo.latestExecutableVersion("missing")).toBeUndefined();
    expect(
      repo.listRuntimeSessions().every((r) => r.status !== "running"),
    ).toBe(true);
  });
});

it("preserves genuine v5 tables/data across bounded indexes and later additive tables, and rolls failed v6 DDL back", () => {
  const root = mkdtempSync(join(tmpdir(), "cw-history-v6-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "v5.sqlite");
  const legacy = openVersion4Fixture(file);
  legacy.sqlite.exec("PRAGMA foreign_keys = OFF; BEGIN");
  migrateIntegritySchema(legacy.sqlite);
  // This fixture constructs exactly step5; production version advancement belongs to the executor.
  legacy.sqlite.exec("PRAGMA user_version = 5; COMMIT; PRAGMA foreign_keys = ON");
  expect(legacy.sqlite.prepare("PRAGMA user_version").get()?.user_version).toBe(
    5,
  );
  const repo = legacyFixtureWriter(legacy.sqlite);
  repo.createOperation(
    "preserved",
    "install",
    "kernel-key-without-environment",
  );
  const original = legacy.sqlite.prepare("SELECT * FROM operations").all();
  const tables = legacy.sqlite
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT IN ('screenshot_artifacts','screenshot_budget','screenshot_reservations','local_workspace','environment_groups','environment_organization','environment_views','batch_tasks','batch_items','environment_commands') ORDER BY name",
    )
    .all();
  const exec = legacy.sqlite.exec.bind(legacy.sqlite);
  const mock = vi.spyOn(legacy.sqlite, "exec").mockImplementation((sql) => {
    if (sql.includes("CREATE INDEX idx_sessions_timeline")) {
      exec("CREATE INDEX partial_failure ON operations(phase)");
      throw new Error("injected DDL failure");
    }
    exec(sql);
  });
  expect(() => migrateDatabase(legacy.sqlite, file)).toThrow(
    "injected DDL failure",
  );
  mock.mockRestore();
  expect(legacy.sqlite.prepare("PRAGMA user_version").get()?.user_version).toBe(
    5,
  );
  expect(legacy.sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(
    1,
  );
  expect(
    legacy.sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE name='partial_failure'")
      .get(),
  ).toBeUndefined();
  legacy.close();
  const migrated = openLocalDatabase(file);
  cleanup.push(migrated.close);
  expect(
    migrated.sqlite.prepare("PRAGMA user_version").get()?.user_version,
  ).toBe(databaseVersion);
  expect(legacyRows(migrated.sqlite, "operations")).toEqual(
    original,
  );
  expect(
    withoutWorkspaceColumn(migrated.sqlite
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT IN ('screenshot_artifacts','screenshot_budget','screenshot_reservations','local_workspace','environment_groups','environment_organization','environment_views','batch_tasks','batch_items','environment_commands') ORDER BY name",
      )
      .all()),
  ).toEqual(tables);
  expect(() =>
    migrated.sqlite.prepare("UPDATE operations SET status='invalid'").run(),
  ).toThrow();
  expect(migrated.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  migrateDatabase(migrated.sqlite, file);
  const backups = readdirSync(root).filter((name) => name.endsWith(".bak"));
  expect(backups).toHaveLength(2); // Failed attempt and successful migration, no backup on reopening current schema.
  const backup = new DatabaseSync(join(root, backups[0]!));
  expect(backup.prepare("PRAGMA user_version").get()?.user_version).toBe(5);
  expect(backup.prepare("SELECT * FROM operations").all()).toEqual(original);
  backup.close();
});

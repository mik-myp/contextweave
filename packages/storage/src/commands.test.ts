import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  environmentConfigSchema,
  type CommandIdentity,
} from "@contextweave/contracts";
import {
  openLocalDatabase,
  EnvironmentRepository,
  WorkspaceRepository,
} from "./index";
import {
  EnvironmentCommandRepository,
  maxActiveEnvironmentCommands,
  verifyCommandStorage,
} from "./commands";
import { openVersion12Fixture, legacyFixtureWriter } from "./legacy-fixture";
import { migrateDatabase, databaseVersion } from "./migrations";
import { BatchRepository } from "./batches";

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function folder() {
  const root = mkdtempSync(join(tmpdir(), "cw-commands-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function track<T extends { sqlite: DatabaseSync; close: () => void }>(
  db: T,
): T {
  cleanups.push(() => {
    if (db.sqlite.isOpen) db.close();
  });
  return db;
}
function fixture() {
  const root = folder(),
    file = join(root, "workspace.sqlite");
  const db = track(openLocalDatabase(file)),
    repo = new EnvironmentRepository(db.sqlite);
  return { root, file, db, repo, store: repo.commands };
}
function identity(
  workspaceId: string,
  changes: Partial<CommandIdentity> = {},
): CommandIdentity {
  return {
    version: 1,
    workspaceId,
    requestId: randomUUID(),
    kind: "start",
    environmentId: "env",
    expectedRevision: 1,
    intentDigest: "a".repeat(64),
    ...changes,
  };
}
const tableRows = (sqlite: DatabaseSync, table: string) =>
  sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

describe("durable environment receipts", () => {
  it("deduplicates queued, completed and reopened requests without recreating the resource", () => {
    const { db, file, repo, store } = fixture();
    const input = identity(repo.workspaceId, {
      kind: "create",
      expectedRevision: null,
    });
    const first = store.reserve(input);
    expect(first).toMatchObject({
      created: true,
      receipt: { status: "queued", environmentId: "env" },
    });
    expect(store.reserve(input)).toEqual({ ...first, created: false });
    expect(store.match(input.requestId, input.intentDigest)).toEqual(
      first.receipt,
    );
    expect(first.receipt).not.toHaveProperty("intentDigest");
    store.start(input.requestId);
    const completed = store.finish(input.requestId, {
      status: "succeeded",
      errorCode: null,
    });
    expect(store.reserve(input)).toEqual({
      created: false,
      receipt: completed,
    });
    db.close();
    const reopened = new EnvironmentCommandRepository(
      track(openLocalDatabase(file)).sqlite,
    );
    expect(reopened.reserve(input)).toEqual({
      created: false,
      receipt: completed,
    });
    expect(reopened.recoverInterrupted()).toBe(0);
  });
  it("rejects changed intent, target, revision, kind and foreign owner while retaining original facts", () => {
    const { repo, store } = fixture(),
      input = identity(repo.workspaceId);
    const first = store.reserve(input);
    for (const changes of [
      { intentDigest: "b".repeat(64) },
      { environmentId: "other" },
      { expectedRevision: 2 },
      { kind: "stop" as const },
    ])
      expect(() => store.reserve({ ...input, ...changes })).toThrow(
        "COMMAND_INTENT_CONFLICT",
      );
    expect(() =>
      store.reserve({ ...input, workspaceId: randomUUID() }),
    ).toThrow("WORKSPACE_MISMATCH");
    expect(store.get(input.requestId)).toEqual(first.receipt);
    expect(() => store.match(input.requestId, "b".repeat(64))).toThrow(
      "COMMAND_INTENT_CONFLICT",
    );
  });
  it("reserves one environment across queued/running commands and retains definite busy rejection", () => {
    const { repo, store } = fixture(),
      input = identity(repo.workspaceId);
    store.reserve(input);
    const busy = identity(repo.workspaceId, { kind: "update" });
    expect(store.reserve(busy).receipt).toMatchObject({
      status: "failed",
      errorCode: "OPERATION_IN_PROGRESS",
    });
    store.start(input.requestId);
    expect(store.active("env")?.requestId).toBe(input.requestId);
    store.finish(input.requestId, { status: "succeeded", errorCode: null });
    expect(store.reserve(busy).receipt.errorCode).toBe("OPERATION_IN_PROGRESS");
    expect(store.reserve(identity(repo.workspaceId)).receipt.status).toBe(
      "queued",
    );
  });
  it("caps active reservations without capping already completed/running browsers", () => {
    const { repo, store } = fixture();
    for (let i = 0; i < maxActiveEnvironmentCommands; i++)
      store.reserve(identity(repo.workspaceId, { environmentId: `env-${i}` }));
    expect(store.reserve(identity(repo.workspaceId)).receipt).toMatchObject({
      status: "failed",
      errorCode: "COMMAND_QUEUE_FULL",
    });
    const first = store.active("env-0")!;
    store.start(first.requestId);
    store.finish(first.requestId, { status: "succeeded", errorCode: null });
    expect(store.reserve(identity(repo.workspaceId)).receipt.status).toBe(
      "queued",
    );
  });
  it("cancels unstarted work, retains unknown effects and requires later confirmed recovery", () => {
    const { repo, store, db, file } = fixture();
    const queued = identity(repo.workspaceId),
      running = identity(repo.workspaceId, { environmentId: "other" });
    store.reserve(queued);
    store.reserve(running);
    store.start(running.requestId);
    db.close();
    const resumed = new EnvironmentCommandRepository(
      track(openLocalDatabase(file)).sqlite,
    );
    expect(resumed.recoverInterrupted()).toBe(2);
    expect(resumed.get(queued.requestId)).toMatchObject({
      status: "cancelled",
      errorCode: "COMMAND_INTERRUPTED",
      startedAt: null,
    });
    const uncertain = resumed.get(running.requestId);
    expect(uncertain).toMatchObject({
      status: "unknown",
      errorCode: "COMMAND_INTERRUPTED",
    });
    expect(resumed.recoverInterrupted()).toBe(0);
    expect(resumed.reserve(running)).toEqual({
      created: false,
      receipt: uncertain,
    });
    expect(resumed.needsInspection("other")).toBe(true);
    expect(
      resumed.reserve(identity(repo.workspaceId, { environmentId: "other" }))
        .receipt.errorCode,
    ).toBe("RECOVERY_REQUIRED");
    const recovery = identity(repo.workspaceId, {
      kind: "recover",
      environmentId: "other",
    });
    resumed.reserve(recovery);
    resumed.start(recovery.requestId);
    expect(resumed.needsInspection("other")).toBe(true);
    resumed.finish(recovery.requestId, {
      status: "succeeded",
      errorCode: null,
    });
    expect(resumed.needsInspection("other")).toBe(false);
    expect(resumed.get(running.requestId)).toEqual(uncertain);
  });
  it("protects receipt identities, state transitions, completion and retention at the SQL boundary", () => {
    const { db, repo, store } = fixture(),
      input = identity(repo.workspaceId);
    store.reserve(input);
    expect(() =>
      db.sqlite
        .prepare("UPDATE environment_commands SET environment_id=?")
        .run("other"),
    ).toThrow("COMMAND_IDENTITY_IMMUTABLE");
    expect(() =>
      store.finish(input.requestId, { status: "succeeded", errorCode: null }),
    ).toThrow();
    store.start(input.requestId);
    expect(() =>
      db.sqlite.exec(
        "UPDATE environment_commands SET status='queued',started_at=NULL",
      ),
    ).toThrow("COMMAND_STATE_CONFLICT");
    const receipt = store.finish(input.requestId, {
      status: "failed",
      errorCode: "CONFIG_CONFLICT",
    });
    expect(
      store.finish(input.requestId, {
        status: "failed",
        errorCode: "CONFIG_CONFLICT",
      }),
    ).toEqual(receipt);
    expect(() =>
      store.finish(input.requestId, { status: "succeeded", errorCode: null }),
    ).toThrow("COMMAND_STATE_CONFLICT");
    expect(() =>
      db.sqlite.exec("UPDATE environment_commands SET error_code='NOT_FOUND'"),
    ).toThrow("COMMAND_TERMINAL_IMMUTABLE");
    expect(() => db.sqlite.exec("DELETE FROM environment_commands")).toThrow(
      "COMMAND_RECEIPT_REQUIRED",
    );
    repo.createOperation("history-only", "start", null);
    db.sqlite.exec("DELETE FROM operations; DELETE FROM runtime_sessions");
    expect(store.get(input.requestId)).toEqual(receipt);
  });
  it("rolls back failed reservation, running and terminal persistence without returning fabricated facts", () => {
    const { db, repo, store } = fixture(),
      input = identity(repo.workspaceId);
    const fault = (event: string) =>
      db.sqlite.exec(
        `CREATE TEMP TRIGGER fault BEFORE ${event} ON environment_commands BEGIN SELECT RAISE(ABORT,'injected'); END`,
      );
    fault("INSERT");
    expect(() => store.reserve(input)).toThrow("injected");
    expect(store.get(input.requestId)).toBeUndefined();
    db.sqlite.exec("DROP TRIGGER fault");
    const queued = store.reserve(input).receipt;
    fault("UPDATE");
    expect(() => store.start(input.requestId)).toThrow("injected");
    expect(store.get(input.requestId)).toEqual(queued);
    db.sqlite.exec("DROP TRIGGER fault");
    const running = store.start(input.requestId);
    fault("UPDATE");
    expect(() =>
      store.finish(input.requestId, { status: "succeeded", errorCode: null }),
    ).toThrow("injected");
    expect(store.get(input.requestId)).toEqual(running);
  });
  it("refuses corrupt or foreign receipt facts when reopening instead of recovering into another owner", () => {
    const { db, repo, store, file } = fixture();
    store.reserve(identity(repo.workspaceId));
    db.sqlite.exec(
      "DROP TRIGGER environment_commands_identity; PRAGMA ignore_check_constraints=ON; PRAGMA foreign_keys=OFF",
    );
    db.sqlite
      .prepare("UPDATE environment_commands SET workspace_id=?")
      .run(randomUUID());
    expect(() => verifyCommandStorage(db.sqlite)).toThrow(
      "DATABASE_INTEGRITY_FAILED",
    );
    db.close();
    // Startup's earlier SQLite quick_check independently detects the violated owner CHECK.
    expect(() => openLocalDatabase(file)).toThrow("DATABASE_CORRUPT");
  });
});

describe("real schema12 to schema13 migration", () => {
  it("preserves every published DDL/row, revisions, credentials, organization, batch and only-copy profile", () => {
    const root = folder(),
      file = join(root, "workspace.sqlite"),
      old = track(openVersion12Fixture(file));
    const writer = legacyFixtureWriter(old.sqlite),
      owner = new WorkspaceRepository(old.sqlite).current();
    writer.saveProxy("proxy", {
      type: "http",
      host: "127.0.0.1",
      port: 8000,
      credentialRef: "opaque-existing-key",
    });
    const config = environmentConfigSchema.parse({
      environmentId: "env",
      name: "Before",
      kernelId: "standard-chromium",
      kernelVersion: "local",
      commonConfig: {},
      proxyId: "proxy",
    });
    writer.create({ config, dataDir: root, platform: "darwin", arch: "arm64" });
    writer.updateConfig({ ...config, name: "After" }, 1);
    old.sqlite
      .prepare(
        "INSERT INTO environment_organization(environment_id,group_id,tags_json,note,revision) VALUES (?,NULL,?,?,1)",
      )
      .run("env", '["original"]', "keep me");
    const batches = new BatchRepository(old.sqlite);
    const time = "2026-09-27T00:00:00.000Z";
    const task = batches.create(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        action: "start",
        sourceTaskId: null,
        createdAt: time,
        expiresAt: "2026-09-27T00:05:00.000Z",
        targets: [
          { environmentId: "env", name: "After", revision: 2, reason: null },
        ],
      },
      time,
    );
    batches.startItem(task.id, 0, time);
    batches.finishItem(task.id, 0, "succeeded", null, time);
    const marker = join(root, "profile-marker");
    writeFileSync(marker, "only-copy");
    const ddl = old.sqlite
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const tables = old.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    const rows = new Map(
      tables.map((table) => [table, tableRows(old.sqlite, table)]),
    );
    old.close();
    const upgraded = track(openLocalDatabase(file));
    expect(
      upgraded.sqlite.prepare("PRAGMA user_version").get()?.user_version,
    ).toBe(databaseVersion);
    expect(new WorkspaceRepository(upgraded.sqlite).current()).toEqual(owner);
    expect(tableRows(upgraded.sqlite, "environment_commands")).toEqual([]);
    for (const entry of ddl)
      expect(
        upgraded.sqlite
          .prepare("SELECT sql FROM sqlite_master WHERE name=?")
          .get(String(entry.name))?.sql,
      ).toBe(entry.sql);
    for (const table of tables)
      expect(tableRows(upgraded.sqlite, table)).toEqual(rows.get(table));
    expect(readFileSync(marker, "utf8")).toBe("only-copy");
    const backups = readdirSync(root).filter((name) =>
      name.includes(`.before-v${databaseVersion}-`),
    );
    expect(backups).toHaveLength(1);
    const backup = track({
      sqlite: new DatabaseSync(join(root, backups[0]!)),
      close() {
        this.sqlite.close();
      },
    });
    expect(
      backup.sqlite.prepare("PRAGMA user_version").get()?.user_version,
    ).toBe(12);
    for (const table of tables)
      expect(tableRows(backup.sqlite, table)).toEqual(rows.get(table));
    upgraded.close();
    track(openLocalDatabase(file));
    expect(
      readdirSync(root).filter((name) => name.includes(".bak")),
    ).toHaveLength(1);
  });
  it("rolls back partial command DDL to genuine schema12 with foreign keys restored", () => {
    const root = folder(),
      file = join(root, "workspace.sqlite"),
      old = track(openVersion12Fixture(file));
    const original = old.sqlite.exec.bind(old.sqlite);
    vi.spyOn(old.sqlite, "exec").mockImplementation((sql) => {
      if (sql.includes("CREATE TABLE environment_commands")) {
        original("CREATE TABLE partial_command(id INTEGER)");
        throw new Error("injected");
      }
      return original(sql);
    });
    expect(() => migrateDatabase(old.sqlite, file)).toThrow("injected");
    expect(old.sqlite.prepare("PRAGMA user_version").get()?.user_version).toBe(
      12,
    );
    expect(
      old.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('environment_commands','partial_command')",
        )
        .all(),
    ).toEqual([]);
    expect(old.sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(
      1,
    );
  });
});

it("allows one durable stop to wait for its own start, rejects outsiders and prevents simultaneous effects", () => {
  const { repo, store } = fixture();
  const start = identity(repo.workspaceId),
    stop = identity(repo.workspaceId, { kind: "stop" });
  store.reserve(start);
  store.start(start.requestId);
  expect(store.reserve(stop).receipt.status).toBe("queued");
  expect(store.active("env")?.requestId).toBe(stop.requestId);
  expect(
    store.reserve(identity(repo.workspaceId, { kind: "update" })).receipt
      .errorCode,
  ).toBe("OPERATION_IN_PROGRESS");
  expect(
    store.reserve(identity(repo.workspaceId, { kind: "stop" })).receipt
      .errorCode,
  ).toBe("OPERATION_IN_PROGRESS");
  expect(() => store.start(stop.requestId)).toThrow(
    "COMMAND_RESOURCE_RESERVED",
  );
  expect(store.get(start.requestId)?.status).toBe("running");
  store.finish(start.requestId, {
    status: "cancelled",
    errorCode: "CANCELLED",
  });
  expect(store.start(stop.requestId).status).toBe("running");
});
it("does not exhaust stop admission when the normal startup reservation pool is full", () => {
  const { repo, store } = fixture();
  for (let i = 0; i < maxActiveEnvironmentCommands; i++)
    store.reserve(identity(repo.workspaceId, { environmentId: `env-${i}` }));
  expect(store.reserve(identity(repo.workspaceId)).receipt.errorCode).toBe(
    "COMMAND_QUEUE_FULL",
  );
  expect(
    store.reserve(
      identity(repo.workspaceId, {
        kind: "stop",
        environmentId: "running-elsewhere",
      }),
    ).receipt.status,
  ).toBe("queued");
  expect(
    store.reserve(
      identity(repo.workspaceId, { kind: "stop", environmentId: "env-0" }),
    ).receipt.status,
  ).toBe("queued");
});

describe("bounded owned command queries", () => {
  it("paginates immutable receipts without omissions, including equal times and later insertions", () => {
    const { repo, store } = fixture();
    const ids = Array.from({ length: 5 }, (_, index) => {
      const item = identity(repo.workspaceId, {
        environmentId: `page-${index}`,
      });
      store.reserve(item, "NOT_FOUND", "2026-01-01T00:00:00.000Z");
      return item.requestId;
    });
    const first = store.page({ limit: 2 });
    expect(first.workspaceId).toBe(repo.workspaceId);
    expect(first.items.map((item) => item.requestId)).toEqual([ids[4], ids[3]]);
    expect(first.nextBeforeId).toBe(ids[3]);
    store.reserve(identity(repo.workspaceId), "NOT_FOUND");
    const second = store.page({ limit: 2, beforeId: first.nextBeforeId });
    expect(second.items.map((item) => item.requestId)).toEqual([
      ids[2],
      ids[1],
    ]);
    const last = store.page({ limit: 2, beforeId: second.nextBeforeId });
    expect(last.items.map((item) => item.requestId)).toEqual([ids[0]]);
    expect(last.nextBeforeId).toBeNull();
    expect(
      store
        .page({ environmentId: "page-2" })
        .items.map((item) => item.requestId),
    ).toEqual([ids[2]]);
    expect(store.page({ environmentId: "missing" })).toMatchObject({
      items: [],
      nextBeforeId: null,
    });
    expect(() => store.page({ beforeId: randomUUID() })).toThrow(
      "COMMAND_CURSOR_INVALID",
    );
    for (const input of [
      { limit: 101 },
      { limit: 0 },
      { beforeId: "wrong" },
      { offset: 1 },
    ])
      expect(() => store.page(input)).toThrow();
    expect(JSON.stringify(first)).not.toMatch(
      /intentDigest|dataDir|credential|intent_digest/,
    );
  });
  it("returns every active receipt in both independent pools, excluding completed and unknown receipts", () => {
    const { repo, store } = fixture();
    const expected: string[] = [];
    for (let i = 0; i < maxActiveEnvironmentCommands; i++) {
      for (const kind of ["start", "stop"] as const) {
        const item = identity(repo.workspaceId, {
          environmentId: `${kind}-${i}`,
          kind,
        });
        store.reserve(item);
        if (i === 0) store.start(item.requestId);
        expected.push(item.requestId);
      }
    }
    store.reserve(identity(repo.workspaceId), "NOT_FOUND");
    const active = store.activeList();
    expect(active.workspaceId).toBe(repo.workspaceId);
    expect(active.items.map((item) => item.requestId)).toEqual(expected);
    expect(active.items).toHaveLength(200);
    store.finish(expected[0], {
      status: "unknown",
      errorCode: "COMMAND_RESULT_UNKNOWN",
    });
    store.finish(expected[1], { status: "succeeded", errorCode: null });
    expect(store.activeList().items.map((item) => item.requestId)).toEqual(
      expected.slice(2),
    );
    store.recoverInterrupted();
    expect(store.activeList().items).toEqual([]);
  });
});

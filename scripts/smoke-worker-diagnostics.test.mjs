import assert from "node:assert/strict";
import { test } from "node:test";
import {
  summarizeWorkerFailure,
  recordWorkerFailure,
} from "./smoke-worker-diagnostics.mjs";

test("native Worker failure summaries preserve known causes without leaking result payloads", () => {
  const secret = "SENSITIVE_CANARY_MUST_NOT_ESCAPE";
  const evidence = summarizeWorkerFailure(
    { ok: false, code: "WORKER_TIMEOUT", message: secret, token: secret },
    0,
    15000.6,
    {
      budget: {
        ok: true,
        data: {
          registered: { count: 0, bytes: 0 },
          reserved: { count: 1, bytes: 33554432 },
          privatePath: secret,
        },
      },
      environment: {
        ok: true,
        data: {
          status: "running",
          name: secret,
          proxy: { password: secret },
          dataDir: secret,
        },
      },
    },
  );
  assert.deepEqual(evidence, {
    stage: "native-worker-screenshot-failure",
    run: 0,
    elapsedMs: 15001,
    ipcOk: false,
    workerOk: false,
    code: "WORKER_TIMEOUT",
    environmentStatus: "running",
    budget: {
      registeredCount: 0,
      registeredBytes: 0,
      reservedCount: 1,
      reservedBytes: 33554432,
    },
  });
  assert(!JSON.stringify(evidence).includes(secret));
});
test("native Worker diagnostic fields are bounded and unknown codes are redacted", () => {
  const secret = "PRIVATE_CODE_CANARY";
  const evidence = summarizeWorkerFailure(
    {
      ok: true,
      data: {
        ok: false,
        errorCode: secret,
        errorMessage: secret,
        screenshotPath: secret,
        title: secret,
      },
    },
    99,
    1e20,
    {
      budget: {
        ok: true,
        data: {
          registered: { count: 1e30, bytes: NaN },
          reserved: { count: -1, bytes: secret },
        },
      },
      environment: { ok: true, data: { status: secret } },
    },
  );
  assert.equal(evidence.run, null);
  assert.equal(evidence.elapsedMs, 60000);
  assert.equal(evidence.code, "REDACTED_OR_UNKNOWN");
  assert.equal(evidence.environmentStatus, "unknown");
  assert.deepEqual(evidence.budget, {
    registeredCount: null,
    registeredBytes: null,
    reservedCount: null,
    reservedBytes: null,
  });
  assert(!JSON.stringify(evidence).includes(secret));
  assert.equal(summarizeWorkerFailure(null, null, NaN, null).elapsedMs, null);
});
test("failed read-only evidence and delivery do not replace the original screenshot failure", async () => {
  const lines = [];
  await recordWorkerFailure(
    { ok: false, code: "WORKER_STOP_FAILED" },
    1,
    20000,
    async () => {
      throw new Error("secret");
    },
    (line) => lines.push(line),
  );
  assert.equal(JSON.parse(lines[0]).code, "WORKER_STOP_FAILED");
  assert.equal(JSON.parse(lines[0]).budget, null);
  await recordWorkerFailure(
    { ok: false },
    0,
    1,
    async () => undefined,
    () => {
      throw new Error("delivery failed");
    },
  );
});
test("successful screenshots do not run failure probes or create diagnostics", async () => {
  await recordWorkerFailure(
    { ok: true, data: { ok: true } },
    0,
    1,
    () => assert.fail("unexpected probe"),
    () => assert.fail("unexpected log"),
  );
});

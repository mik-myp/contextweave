// Native gate diagnostics: never dump a Worker response or the packaged process output.
const codes = new Set([
  "ENVIRONMENT_NOT_RUNNING",
  "WORKER_BUSY",
  "WORKER_INPUT_LIMIT",
  "WORKER_FAILED",
  "WORKER_ERROR",
  "WORKER_TIMEOUT",
  "WORKER_STOP_FAILED",
  "WORKER_OUTPUT_FAILED",
  "WORKER_OUTPUT_UNAVAILABLE",
  "WORKER_OUTPUT_LIMIT",
  "WORKER_OUTPUT_INVALID",
  "WORKER_OUTPUT_CLEANUP_FAILED",
  "WORKER_OUTPUT_REGISTRATION_UNCONFIRMED",
  "WORKER_OUTPUT_RESERVATION_UNCONFIRMED",
  "ARTIFACT_BUDGET_EXCEEDED",
  "CANCELLED",
]);
const statuses = new Set([
  "created",
  "stopped",
  "starting",
  "running",
  "stopping",
  "crashed",
  "needs-recovery",
  "deleted",
]);
const code = (value) => (codes.has(value) ? value : "REDACTED_OR_UNKNOWN");
const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;

export function summarizeWorkerFailure(outcome, run, elapsedMs, snapshot) {
  const budget =
    snapshot?.budget?.ok === true ? snapshot.budget.data : undefined;
  const environment =
    snapshot?.environment?.ok === true ? snapshot.environment.data : undefined;
  return {
    stage: "native-worker-screenshot-failure",
    run: run === 0 || run === 1 ? run : null,
    elapsedMs:
      Number.isFinite(elapsedMs) && elapsedMs >= 0
        ? Math.min(60000, Math.round(elapsedMs))
        : null,
    ipcOk: outcome?.ok === true,
    workerOk: outcome?.ok === true && outcome?.data?.ok === true,
    code: code(outcome?.ok === true ? outcome?.data?.errorCode : outcome?.code),
    environmentStatus: statuses.has(environment?.status)
      ? environment.status
      : "unknown",
    budget: budget
      ? {
          registeredCount: count(budget.registered?.count),
          registeredBytes: count(budget.registered?.bytes),
          reservedCount: count(budget.reserved?.count),
          reservedBytes: count(budget.reserved?.bytes),
        }
      : null,
  };
}

export async function recordWorkerFailure(
  outcome,
  run,
  elapsedMs,
  readSnapshot,
  emit = console.error,
) {
  if (outcome?.ok === true && outcome?.data?.ok === true) return;
  let snapshot;
  try {
    snapshot = await readSnapshot();
  } catch {
    /* A failed probe cannot replace the original assertion. */
  }
  try {
    emit(
      JSON.stringify(summarizeWorkerFailure(outcome, run, elapsedMs, snapshot)),
    );
  } catch {
    /* Diagnostic delivery is not the failing gate. */
  }
}

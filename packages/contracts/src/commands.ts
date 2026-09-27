import { environmentStatusSchema } from "./environment-status";
import { z } from "zod";
import { preflightIssueSchema } from "./lifecycle";
import { workspaceContextSchema } from "./workspaces";

export const environmentCommandKindSchema = z.enum([
  "create",
  "update",
  "start",
  "stop",
  "trash",
  "restore",
  "recover",
]);
export type EnvironmentCommandKind = z.infer<
  typeof environmentCommandKindSchema
>;
export const commandRequestIdSchema = z.string().uuid().toLowerCase();
export const commandIntentDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const commandEnvironmentIdSchema = z.string().trim().min(1).max(512);
export const commandRevisionSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
export const environmentCommandReferenceSchema = z.strictObject({
  environmentId: commandEnvironmentIdSchema,
  expectedRevision: commandRevisionSchema,
});
export const environmentCommandStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);
export type EnvironmentCommandStatus = z.infer<
  typeof environmentCommandStatusSchema
>;
export const isEnvironmentCommandActive = (status: EnvironmentCommandStatus) =>
  status === "queued" || status === "running";

export const commandErrorCodeSchema = z.enum([
  ...preflightIssueSchema.shape.code.options,
  "NOT_FOUND",
  "CONFIG_CONFLICT",
  "ENVIRONMENT_BUSY",
  "OPERATION_IN_PROGRESS",
  "ENVIRONMENT_NOT_TRASHED",
  "ENVIRONMENT_NOT_RUNNING",
  "ALREADY_RUNNING",
  "RECOVERY_LOCK_UNREADABLE",
  "RECOVERY_MANUAL_REQUIRED",
  "IP_LOCALE_FAILED",
  "KERNEL_VERSION_MISMATCH",
  "SPAWN_FAILED",
  "START_FAILED",
  "STOP_TIMEOUT",
  "CANCELLED",
  "APP_CLOSING",
  "APP_UPDATING",
  "COMMAND_FAILED",
  "COMMAND_INTERRUPTED",
  "COMMAND_RESULT_UNKNOWN",
  "COMMAND_STORAGE_FAILED",
  "COMMAND_INTENT_CONFLICT",
  "COMMAND_QUEUE_FULL",
]);
export type CommandErrorCode = z.infer<typeof commandErrorCodeSchema>;

/** Public facts only: no intent body/digest, config, credential, path or arbitrary IPC result. */
const commandFactsSchema = workspaceContextSchema.extend({
  version: z.literal(1),
  requestId: commandRequestIdSchema,
  kind: environmentCommandKindSchema,
  environmentId: commandEnvironmentIdSchema,
  expectedRevision: commandRevisionSchema.nullable(),
  status: environmentCommandStatusSchema,
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  errorCode: commandErrorCodeSchema.nullable(),
});

export const commandIdentitySchema = commandFactsSchema
  .pick({
    version: true,
    workspaceId: true,
    requestId: true,
    kind: true,
    environmentId: true,
    expectedRevision: true,
  })
  .extend({ intentDigest: commandIntentDigestSchema });
export type CommandIdentity = z.infer<typeof commandIdentitySchema>;

export const environmentCommandReceiptSchema = commandFactsSchema.refine(
  (receipt) => {
    if ((receipt.kind === "create") !== (receipt.expectedRevision === null))
      return false;
    if (receipt.status === "queued")
      return (
        receipt.startedAt === null &&
        receipt.endedAt === null &&
        receipt.errorCode === null
      );
    if (receipt.status === "running")
      return (
        receipt.startedAt !== null &&
        receipt.endedAt === null &&
        receipt.errorCode === null
      );
    if (receipt.endedAt === null) return false;
    if (receipt.status === "succeeded")
      return receipt.startedAt !== null && receipt.errorCode === null;
    if (receipt.errorCode === null) return false;
    if (receipt.status === "cancelled")
      return ["CANCELLED", "APP_CLOSING", "COMMAND_INTERRUPTED"].includes(
        receipt.errorCode,
      );
    if (receipt.status === "unknown")
      return (
        receipt.startedAt !== null &&
        [
          "COMMAND_INTERRUPTED",
          "COMMAND_STORAGE_FAILED",
          "COMMAND_RESULT_UNKNOWN",
          "STOP_TIMEOUT",
          "START_FAILED",
          "SPAWN_FAILED",
        ].includes(receipt.errorCode)
      );
    return ![
      "CANCELLED",
      "COMMAND_INTERRUPTED",
      "COMMAND_STORAGE_FAILED",
      "COMMAND_RESULT_UNKNOWN",
    ].includes(receipt.errorCode);
  },
);
export type EnvironmentCommandReceipt = z.infer<
  typeof environmentCommandReceiptSchema
>;

/** Read-only recovery evidence. Does not expose process IDs, control access or local paths. */
export const environmentRecoveryInspectionSchema = workspaceContextSchema
  .extend({
    environmentId: commandEnvironmentIdSchema,
    revision: commandRevisionSchema,
    status: environmentStatusSchema,
    lifecycle: z.enum(["active", "trashed"]),
    inspectedAt: z.string().datetime(),
    ownedByThisApp: z.boolean(),
    lockState: z.enum(["absent", "stale", "live", "unreadable"]),
    recordedActiveSessions: z.number().int().nonnegative(),
    possiblyLiveSessions: z.number().int().nonnegative(),
    hasUnconfirmedCommand: z.boolean(),
    canRecover: z.boolean(),
    reason: z
      .enum([
        "RUNTIME_BUSY",
        "RECOVERY_LOCK_UNREADABLE",
        "RECOVERY_MANUAL_REQUIRED",
      ])
      .nullable(),
  })
  .refine(
    (inspection) =>
      inspection.possiblyLiveSessions <= inspection.recordedActiveSessions &&
      inspection.canRecover === (inspection.reason === null) &&
      (!inspection.canRecover ||
        (!inspection.ownedByThisApp &&
          inspection.possiblyLiveSessions === 0 &&
          ["absent", "stale"].includes(inspection.lockState))),
  );
export type EnvironmentRecoveryInspection = z.infer<
  typeof environmentRecoveryInspectionSchema
>;

export const environmentCommandPageInputSchema = z.strictObject({
  beforeId: commandRequestIdSchema.nullable().default(null),
  limit: z.number().int().min(1).max(100).default(20),
  environmentId: commandEnvironmentIdSchema.optional(),
});
export type EnvironmentCommandPageInput = z.input<
  typeof environmentCommandPageInputSchema
>;
function ownedUniqueReceipts(value: {
  workspaceId: string;
  items: EnvironmentCommandReceipt[];
}) {
  return (
    value.items.every((item) => item.workspaceId === value.workspaceId) &&
    new Set(value.items.map((item) => item.requestId)).size ===
      value.items.length
  );
}
export const environmentCommandPageSchema = workspaceContextSchema
  .extend({
    items: z.array(environmentCommandReceiptSchema).max(100),
    nextBeforeId: commandRequestIdSchema.nullable(),
  })
  .refine(ownedUniqueReceipts)
  .refine(
    (value) =>
      value.nextBeforeId === null ||
      value.items.at(-1)?.requestId === value.nextBeforeId,
  );
export const environmentCommandActiveSchema = workspaceContextSchema
  .extend({
    items: z.array(environmentCommandReceiptSchema).max(200),
  })
  .refine(ownedUniqueReceipts)
  .refine((value) =>
    value.items.every((item) => isEnvironmentCommandActive(item.status)),
  );

import { z } from 'zod'

export const capabilityStateSchema = z.enum(['unverified', 'verified', 'unsupported', 'failed'])
export const capabilityEvidenceSchema = z
  .object({
    declared: z.boolean(),
    state: capabilityStateSchema,
    checkedAt: z.string().datetime().optional(),
    version: z.string().optional(),
    evidence: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.state === 'verified' && (!value.version || !value.checkedAt || !value.evidence))
      context.addIssue({
        code: 'custom',
        message: 'Verified capabilities require versioned, dated evidence',
      })
  })
export const kernelSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  family: z.string(),
  platform: z.string(),
  arch: z.string(),
  version: z.string(),
  status: z.string(),
  executablePath: z.string().optional(),
  installationPath: z.string().optional(),
  packageAvailable: z.boolean(),
  removable: z.boolean().default(false),
  removalPending: z.boolean().default(false),
  referenceCount: z.number().int().nonnegative().default(0),
  capabilities: z.record(z.string(), z.boolean()),
  capabilityReport: z.record(z.string(), capabilityEvidenceSchema),
  providerStatus: z.enum(['native', 'unconfigured', 'candidate', 'verified']),
  source: z.string().url().optional(),
  license: z.string().optional(),
  unsupportedReason: z.string().optional(),
  installation: z.object({
    phase: z.enum(['downloading', 'verifying', 'extracting', 'complete', 'failed', 'cancelled']),
    receivedBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative(),
    errorCode: z.string().optional(),
  }).optional(),
})
export type KernelSummary = z.infer<typeof kernelSummarySchema>
export type CapabilityEvidence = z.infer<typeof capabilityEvidenceSchema>

export const preflightIssueSchema = z.object({
  code: z.enum([
    'CONFIG_INVALID',
    'ENVIRONMENT_TRASHED',
    'KERNEL_UNAVAILABLE',
    'PROVIDER_UNVERIFIED',
    'PLATFORM_MISMATCH',
    'RUNTIME_BUSY',
    'RECOVERY_REQUIRED',
    'PROXY_MISSING',
    'PROXY_UNREACHABLE',
    'PROXY_TEST_FAILED',
    'CREDENTIAL_UNAVAILABLE',
    'DIRECTORY_UNWRITABLE',
    'LOW_DISK',
    'NATIVE_MODE',
    'VERSION_CHANGED',
    'LEGACY_SETTINGS_UNSUPPORTED',
  ]),
  severity: z.enum(['error', 'warning', 'info']),
})
export const preflightReportSchema = z.object({
  environmentId: z.string(),
  revision: z.number().int().positive(),
  checkedAt: z.string().datetime(),
  canStart: z.boolean(),
  executableVersion: z.string().optional(),
  issues: z.array(preflightIssueSchema),
})
export type PreflightReport = z.infer<typeof preflightReportSchema>
export type PreflightIssue = z.infer<typeof preflightIssueSchema>

export const operationKindSchema = z.enum([
  'start',
  'stop',
  'recover',
  'create',
  'update',
  'trash',
  'restore',
  'install',
  'remove-kernel',
])
export type OperationKind = z.infer<typeof operationKindSchema>
export const operationSummarySchema = z.object({
  operationId: z.string(),
  environmentId: z.string().nullable(),
  environmentName: z.string().optional(),
  kind: operationKindSchema,
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  phase: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
})
export type OperationSummary = z.infer<typeof operationSummarySchema>
export const dataDomainSchema = z.enum([
  'environments',
  'proxies',
  'kernels',
  'activity',
  'operations',
  'storage',
])
export type DataDomain = z.infer<typeof dataDomainSchema>
export const dataChangedSchema = z.object({ domains: z.array(dataDomainSchema) })
export const orphanDirectorySchema = z.object({
  name: z.string(),
  modifiedAt: z.string().datetime(),
})
export type OrphanDirectory = z.infer<typeof orphanDirectorySchema>

export const kernelReleaseSchema = z.object({
  retained: z.boolean().optional(),
  id: z.string(),
  provider: z.string(),
  sourceType: z.enum(['official', 'custom']).optional(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  publishedAt: z.string().optional(),
  source: z.string().url(),
  sizeBytes: z.number().optional(),
  sha256: z.string().optional(),
  installable: z.boolean(),
  installed: z.boolean(),
  reason: z.enum(['PLATFORM_UNSUPPORTED', 'ADAPTER_UNSUPPORTED', 'CHECKSUM_UNAVAILABLE', 'RELEASE_UNREVIEWED']).optional(),
  installation: kernelSummarySchema.shape.installation,
})
export type KernelRelease = z.infer<typeof kernelReleaseSchema>
export const kernelCatalogSchema = z.object({
  sourceStatus: z.enum(['live', 'cached', 'bundled']),
  releases: z.array(kernelReleaseSchema),
})
export type KernelCatalog = z.infer<typeof kernelCatalogSchema>

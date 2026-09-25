import { z } from 'zod'

export const protocolVersion = 1 as const

export const environmentStatusSchema = z.enum([
  'created',
  'ready',
  'starting',
  'running',
  'stopping',
  'stopped',
  'error',
  'needs-recovery',
])
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>

export const kernelFamilySchema = z.enum(['chromium', 'firefox'])
export type KernelFamily = z.infer<typeof kernelFamilySchema>

export const controlProtocolSchema = z.enum(['cdp', 'juggler', 'custom'])
export type ControlProtocol = z.infer<typeof controlProtocolSchema>

export const platformSchema = z.enum(['win32', 'darwin', 'linux'])
export type TargetPlatform = z.infer<typeof platformSchema>

export const architectureSchema = z.enum(['x64', 'arm64'])
export type TargetArchitecture = z.infer<typeof architectureSchema>

export const appInfoSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    platform: platformSchema,
    arch: architectureSchema,
    secureStorageAvailable: z.boolean(),
  })
  .strict()
export type AppInfo = z.infer<typeof appInfoSchema>

export const appPathsSchema = z
  .object({
    userData: z.string().min(1),
    dataRoot: z.string().min(1),
    environmentRoot: z.string().min(1),
    kernelRoot: z.string().min(1),
    logRoot: z.string().min(1),
  })
  .strict()
export type AppPaths = z.infer<typeof appPathsSchema>

export const externalUrlSchema = z
  .string()
  .url()
  .max(8192)
  .refine((value) => {
    try {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    } catch {
      return false
    }
  }, 'Only HTTP(S) URLs without embedded credentials are supported')

export const proxyTypeSchema = z.enum(['http', 'https', 'socks5'])
export type ProxyType = z.infer<typeof proxyTypeSchema>

// Hosts are serialized into Chromium's proxy URI; accept hostnames, IPv4 and bracketed IPv6 only.
export const proxyHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => {
    if (/[\s/?#@\\]/.test(value)) return false
    try {
      const url = new URL(`http://${value}`)
      if (url.port || url.username || url.password || url.pathname !== '/') return false
      if (value.startsWith('[')) return value.endsWith(']')
      return (
        !value.includes(':') &&
        value
          .replace(/\.$/, '')
          .split('.')
          .every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))
      )
    } catch {
      return false
    }
  }, 'Invalid proxy host')

export const proxyConfigSchema = z.object({
  name: z.string().trim().max(80).optional(),
  type: proxyTypeSchema,
  host: proxyHostSchema,
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).optional(),
  credentialRef: z.string().trim().min(1).optional(),
})
export type ProxyConfig = z.infer<typeof proxyConfigSchema>

export const kernelCapabilitiesSchema = z.object({
  cdp: z.boolean(),
  screenshot: z.boolean(),
  fileUpload: z.boolean(),
  elementScreenshot: z.boolean(),
  userAgent: z.boolean(),
  timezone: z.boolean(),
  proxy: z.boolean(),
  webRtcPolicy: z.boolean(),
})
export type KernelCapabilities = z.infer<typeof kernelCapabilitiesSchema>

export const kernelPackageSchema = z.object({
  url: z.string().url().optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  sizeBytes: z.number().int().positive().optional(),
})

export const kernelManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  family: kernelFamilySchema,
  version: z.string().trim().min(1),
  platform: platformSchema,
  arch: architectureSchema,
  executable: z.string().trim().min(1),
  package: kernelPackageSchema.optional(),
  sourceType: z.enum(['official', 'custom']).optional(),
  controlProtocol: controlProtocolSchema,
  capabilities: kernelCapabilitiesSchema,
  configSchema: z.string().trim().min(1),
  dataDirCompatibility: z.array(z.string().trim().min(1)),
  source: z.string().url().optional(),
  license: z.string().trim().min(1),
})
export type KernelManifest = z.infer<typeof kernelManifestSchema>

export const browserLanguageSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (value === 'system' || value === 'auto') return true
    try {
      return Intl.getCanonicalLocales(value).length === 1
    } catch {
      return false
    }
  }, 'Invalid browser language')

export const browserTimezoneSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (value === 'system' || value === 'auto') return true
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return value.length > 0
    } catch {
      return false
    }
  }, 'Invalid timezone')

// Preview accepts a saved proxy identity, never an arbitrary endpoint or a secret.
export const ipLocaleRequestSchema = z.discriminatedUnion('connection', [
  z.object({ requestId: z.string().uuid(), connection: z.literal('direct') }).strict(),
  z.object({ requestId: z.string().uuid(), connection: z.literal('proxy'), proxyId: z.string().trim().min(1).max(200) }).strict(),
])
export type IpLocaleRequest = z.infer<typeof ipLocaleRequestSchema>
export const ipLocaleCancelSchema = z.string().uuid()
export const ipLocaleResultSchema = z.object({
  ip: z.union([z.ipv4(), z.ipv6()]),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  language: browserLanguageSchema.refine((value) => !['auto', 'system'].includes(value)),
  timezone: browserTimezoneSchema.refine((value) => !['auto', 'system'].includes(value)),
  connection: z.enum(['direct', 'proxy']),
  provider: z.literal('ipwho.is'),
  checkedAt: z.string().datetime(),
}).strict()
export type IpLocaleResult = z.infer<typeof ipLocaleResultSchema>

const browserWindowSchema = z
  .object({
    width: z.number().int().min(640).max(7680),
    height: z.number().int().min(480).max(4320),
  })
  .strict()

export const commonEnvironmentConfigSchema = z.object({
  language: browserLanguageSchema.default('zh-CN'),
  timezone: browserTimezoneSchema.default('Asia/Shanghai'),
  userAgent: z.string().trim().min(1).optional(),
  platform: z.string().trim().min(1).optional(),
  window: browserWindowSchema
    .extend({
      width: browserWindowSchema.shape.width.default(1440),
      height: browserWindowSchema.shape.height.default(900),
    })
    .default({ width: 1440, height: 900 }),
  hardwareConcurrency: z.number().int().min(1).max(256).default(8),
  webRtcPolicy: z.enum(['proxy', 'disable', 'default']).default('proxy'),
  dnsPolicy: z.enum(['proxy', 'system']).default('proxy'),
})
export type CommonEnvironmentConfig = z.infer<typeof commonEnvironmentConfigSchema>
export const defaultCommonEnvironmentConfig = commonEnvironmentConfigSchema.parse({})

export const environmentConfigSchema = z.object({
  environmentId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  kernelId: z.string().trim().min(1),
  kernelVersion: z.string().trim().min(1),
  proxyId: z.string().trim().min(1).optional(),
  proxy: proxyConfigSchema.optional(),
  commonConfig: commonEnvironmentConfigSchema,
  kernelConfig: z.record(z.string(), z.unknown()).default({}),
  configVersion: z.literal(1).default(1),
})
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>

export const createEnvironmentInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kernelId: z.string().trim().min(1),
  proxyId: z.string().trim().min(1).optional(),
  proxy: proxyConfigSchema.optional(),
  commonConfig: commonEnvironmentConfigSchema.default(defaultCommonEnvironmentConfig),
  kernelConfig: z.record(z.string(), z.unknown()).default({}),
})
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentInputSchema>

export const browserSettingsSchema = z
  .object({
    language: browserLanguageSchema,
    timezone: browserTimezoneSchema,
    window: browserWindowSchema,
  })
  .strict()
export type BrowserSettings = z.infer<typeof browserSettingsSchema>
export const environmentIdSchema = z.string().trim().min(1)

// Editing preserves the kernel, profile directory, and configuration not exposed by the form.
export const updateEnvironmentInputSchema = z
  .object({
    version: z.literal(1),
    expectedRevision: z.number().int().positive().optional(),
    environmentId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(80),
    proxyId: z.string().trim().min(1).nullable(),
    browserSettings: browserSettingsSchema,
  })
  .strict()
export type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentInputSchema>

export const proxySummarySchema = proxyConfigSchema.omit({ credentialRef: true }).extend({
  proxyId: z.string().min(1),
  hasPassword: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type ProxySummary = z.infer<typeof proxySummarySchema>

export const credentialCleanupStatusSchema = z
  .object({
    pendingCount: z.number().int().nonnegative(),
    temporaryFilesPending: z.boolean(),
  })
  .strict()
export type CredentialCleanupStatus = z.infer<typeof credentialCleanupStatusSchema>

export const saveProxyInputSchema = z
  .object({
    proxyId: z.string().trim().min(1).optional(),
    config: proxyConfigSchema.omit({ credentialRef: true }),
    password: z.string().min(1).optional(),
    clearPassword: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.password && !input.config.username)
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'username'],
        message: 'Username is required for a password',
      })
    if (input.password && input.clearPassword)
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Cannot set and clear a password together',
      })

  })
export type SaveProxyInput = z.infer<typeof saveProxyInputSchema>

export const importProxiesInputSchema = z.object({
  text: z.string().min(1).max(65536).refine((text) => text.split(/\r?\n/).length <= 200),
  defaultType: proxyTypeSchema.default('http'),
}).strict()
export type ImportProxiesInput = z.infer<typeof importProxiesInputSchema>
export const importProxyRowSchema = z.object({
  line: z.number().int().min(1).max(200),
  status: z.enum(['created', 'skipped', 'error']),
  proxyId: z.string().min(1).optional(),
  code: z.enum(['INVALID_PROXY_LINE', 'PROXY_ALREADY_EXISTS', 'CREDENTIAL_UNAVAILABLE', 'PROXY_SAVE_FAILED']).optional(),
}).strict()
export const importProxiesResultSchema = z.array(importProxyRowSchema).max(200)
export type ImportProxiesResult = z.infer<typeof importProxiesResultSchema>

/** Parse one bounded import line. Callers must never expose raw parser errors or the source URI. */
export function parseProxyLine(line: string, defaultType: ProxyType = 'http'): SaveProxyInput {
  const text = line.trim()
  if (!text || /[\s\u0000-\u001f\u007f]/.test(text)) throw new Error('INVALID_PROXY_LINE')
  const scheme = /^([a-z0-9]+):\/\//i.exec(text)
  const protocol = (scheme?.[1] ?? defaultType).toLowerCase()
  const type = proxyTypeSchema.parse(['socket5', 'socks5h'].includes(protocol) ? 'socks5' : protocol)
  const address = scheme ? text.slice(scheme[0].length) : text
  const legacy = /^(\[[^\]]+\]|[^:@/?#]+):(\d+)(?::([^:]+):(.+))?$/.exec(address)
  if (legacy) return saveProxyInputSchema.parse({
    config: { type, host: legacy[1], port: Number(legacy[2]), username: legacy[3] },
    password: legacy[4],
  })
  const url = new URL(`${type}://${address}`)
  const explicitPort = /:(\d+)\/?$/.exec(address.split('@').at(-1) ?? '')?.[1]
  if (!explicitPort || !['', '/'].includes(url.pathname) || url.search || url.hash)
    throw new Error('INVALID_PROXY_LINE')
  return saveProxyInputSchema.parse({
    config: { type, host: url.hostname, port: Number(explicitPort), username: decodeURIComponent(url.username) || undefined },
    password: decodeURIComponent(url.password) || undefined,
  })
}

export const proxyTestInputSchema = z.union([
  z.object({ proxyId: z.string().min(1) }).strict(),
  saveProxyInputSchema,
])
export type ProxyTestInput = z.infer<typeof proxyTestInputSchema>
export const proxyTestResultSchema = z.object({
  success: z.boolean(),
  latencyMs: z.number().nonnegative(),
  checkedAt: z.string().datetime(),
  exitIp: z.string().optional(),
  exitIpUnavailable: z.boolean().optional(),
  connectivity: z.enum(['http', 'https']).optional(),
  errorCode: z.enum(['PROXY_TEST_FAILED', 'PROXY_TEST_TIMEOUT', 'CREDENTIAL_UNAVAILABLE']).optional(),
})
export type ProxyTestResult = z.infer<typeof proxyTestResultSchema>

export const fingerprintIdentitySchema = z.object({
  seed: z.number().int().min(1).max(4294967295),
  platform: z.enum(['windows', 'macos', 'linux']),
  hardwareConcurrency: z.number().int().min(1).max(64),
}).strict()
export type FingerprintIdentity = z.infer<typeof fingerprintIdentitySchema>

export * from './theme'

export const environmentSummarySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  status: environmentStatusSchema,
  kernelId: z.string().trim().min(1),
  kernelVersion: z.string().trim().min(1),
  proxyId: z.string().trim().min(1).optional(),
  platform: platformSchema,
  arch: architectureSchema,
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive().optional(),
  lifecycle: z.enum(['active', 'trashed']).optional(),
  trashedAt: z.string().datetime().nullable().optional(),
})
export type EnvironmentSummary = z.infer<typeof environmentSummarySchema>

// Safe editor projection: no profile paths, credentials, or kernel-private configuration.
export const environmentDetailsSchema = environmentSummarySchema
  .extend({
    browserSettings: browserSettingsSchema,
    fingerprint: fingerprintIdentitySchema.optional(),
  })
  .strict()
export type EnvironmentDetails = z.infer<typeof environmentDetailsSchema>

export function ipcResultSchema<T>(data: z.ZodType<T>) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
  ])
}

export const runtimeSessionSchema = z.object({
  processIdentity: z.string().min(1).optional(),
  sessionId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  pid: z.number().int().positive(),
  controlPort: z.number().int().min(1).max(65535),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().optional(),
  revision: z.number().int().positive().optional(),
  kernelVersion: z.string().optional(),
  executableVersion: z.string().optional(),
  phase: z.string().optional(),
  status: z.enum(['starting', 'running', 'stopping', 'stopped', 'crashed']),
})
export type RuntimeSession = z.infer<typeof runtimeSessionSchema>

export const runtimeLockOwnerSchema = runtimeSessionSchema.pick({
  pid: true, sessionId: true, controlPort: true, startedAt: true, processIdentity: true,
})
export type RuntimeLockOwner = z.infer<typeof runtimeLockOwnerSchema>

export const activitySummarySchema = runtimeSessionSchema
  .omit({ pid: true, controlPort: true, processIdentity: true })
  .extend({
    environmentName: z.string().optional(),
    exitReason: z.string().nullable(),
  })
export type ActivitySummary = z.infer<typeof activitySummarySchema>

export type IpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

export * from './lifecycle'

export const kernelProviderSchema = z.object({ id: z.string(), label: z.string(), license: z.string() })
export const kernelCatalogInputSchema = z.object({ providerId: z.string().min(1), refresh: z.boolean().default(false) })
export const customKernelSourceSchema = z.object({
  providerId: z.string().min(1),
  url: z.string().url().max(4096).refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash
    } catch {
      return false
    }
  }, 'A direct HTTPS URL without embedded credentials is required'),
  version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/).optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  trustedSource: z.boolean().default(false),
}).strict()
export type CustomKernelSource = z.infer<typeof customKernelSourceSchema>

export * from './updates'

export * from './logs'

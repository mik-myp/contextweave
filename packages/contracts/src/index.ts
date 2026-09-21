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

export const proxyTypeSchema = z.enum(['http', 'https', 'socks5'])
export type ProxyType = z.infer<typeof proxyTypeSchema>

export const proxyConfigSchema = z.object({
  type: proxyTypeSchema,
  host: z.string().trim().min(1),
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
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
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
  controlProtocol: controlProtocolSchema,
  capabilities: kernelCapabilitiesSchema,
  configSchema: z.string().trim().min(1),
  dataDirCompatibility: z.array(z.string().trim().min(1)),
  source: z.string().url().optional(),
  license: z.string().trim().min(1),
})
export type KernelManifest = z.infer<typeof kernelManifestSchema>

export const commonEnvironmentConfigSchema = z.object({
  language: z.string().trim().min(2).default('zh-CN'),
  timezone: z.string().trim().min(1).default('Asia/Shanghai'),
  userAgent: z.string().trim().min(1).optional(),
  platform: z.string().trim().min(1).optional(),
  window: z.object({
    width: z.number().int().min(640).max(7680).default(1440),
    height: z.number().int().min(480).max(4320).default(900),
  }).default({ width: 1440, height: 900 }),
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

export const saveProxyInputSchema = z.object({
  proxyId: z.string().trim().min(1).optional(),
  config: proxyConfigSchema,
  password: z.string().min(1).optional(),
})
export type SaveProxyInput = z.infer<typeof saveProxyInputSchema>

export const themeModeSchema = z.enum(['light', 'dark', 'system'])
export type ThemeMode = z.infer<typeof themeModeSchema>

export const themePresetSchema = z.enum(['signal-weave', 'graphite', 'ocean', 'amber'])
export type ThemePreset = z.infer<typeof themePresetSchema>

export const themeRadiusSchema = z.enum(['none', 'sm', 'md', 'lg', 'xl'])
export type ThemeRadius = z.infer<typeof themeRadiusSchema>

export const themeDensitySchema = z.enum(['compact', 'comfortable', 'spacious'])
export type ThemeDensity = z.infer<typeof themeDensitySchema>

export const themeFontSchema = z.enum(['geist', 'system', 'serif', 'mono'])
export type ThemeFont = z.infer<typeof themeFontSchema>

export const sidebarLayoutSchema = z.enum(['sidebar', 'inset', 'floating', 'offcanvas'])
export type SidebarLayout = z.infer<typeof sidebarLayoutSchema>

export const themeConfigSchema = z.object({
  version: z.literal(1),
  mode: themeModeSchema,
  preset: themePresetSchema,
  radius: themeRadiusSchema,
  density: themeDensitySchema,
  font: themeFontSchema,
  sidebarLayout: sidebarLayoutSchema,
})
export type ThemeConfig = z.infer<typeof themeConfigSchema>

export const defaultThemeConfig: ThemeConfig = {
  version: 1,
  mode: 'system',
  preset: 'signal-weave',
  radius: 'md',
  density: 'comfortable',
  font: 'geist',
  sidebarLayout: 'sidebar',
}

export const environmentSummarySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  status: environmentStatusSchema,
  kernelId: z.string().trim().min(1),
  kernelVersion: z.string().trim().min(1),
  platform: platformSchema,
  arch: architectureSchema,
  updatedAt: z.string().datetime(),
})
export type EnvironmentSummary = z.infer<typeof environmentSummarySchema>

export const runtimeSessionSchema = z.object({
  sessionId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  pid: z.number().int().positive(),
  controlPort: z.number().int().min(1).max(65535),
  startedAt: z.string().datetime(),
  status: z.enum(['starting', 'running', 'stopping', 'stopped', 'crashed']),
})
export type RuntimeSession = z.infer<typeof runtimeSessionSchema>

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

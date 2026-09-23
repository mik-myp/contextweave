import { z } from "zod";

export const protocolVersion = 1 as const;

export const environmentStatusSchema = z.enum([
  "created",
  "ready",
  "starting",
  "running",
  "stopping",
  "stopped",
  "error",
  "needs-recovery",
]);
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

export const kernelFamilySchema = z.enum(["chromium", "firefox"]);
export type KernelFamily = z.infer<typeof kernelFamilySchema>;

export const controlProtocolSchema = z.enum(["cdp", "juggler", "custom"]);
export type ControlProtocol = z.infer<typeof controlProtocolSchema>;

export const platformSchema = z.enum(["win32", "darwin", "linux"]);
export type TargetPlatform = z.infer<typeof platformSchema>;

export const architectureSchema = z.enum(["x64", "arm64"]);
export type TargetArchitecture = z.infer<typeof architectureSchema>;

export const proxyTypeSchema = z.enum(["http", "https", "socks5"]);
export type ProxyType = z.infer<typeof proxyTypeSchema>;

// Hosts are serialized into Chromium's proxy URI; accept hostnames, IPv4 and bracketed IPv6 only.
export const proxyHostSchema = z.string().trim().min(1).max(253).refine(
  (value) => {
    if (/[\s/?#@\\]/.test(value)) return false;
    try {
      const url = new URL(`http://${value}`);
      if (url.port || url.username || url.password || url.pathname !== "/") return false;
      if (value.startsWith("[")) return value.endsWith("]");
      return !value.includes(":") && value.replace(/\.$/, "").split(".").every(
        (label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
      );
    } catch { return false; }
  },
  "Invalid proxy host",
);

export const proxyConfigSchema = z.object({
  type: proxyTypeSchema,
  host: proxyHostSchema,
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).optional(),
  credentialRef: z.string().trim().min(1).optional(),
});
export type ProxyConfig = z.infer<typeof proxyConfigSchema>;

export const kernelCapabilitiesSchema = z.object({
  cdp: z.boolean(),
  screenshot: z.boolean(),
  fileUpload: z.boolean(),
  elementScreenshot: z.boolean(),
  userAgent: z.boolean(),
  timezone: z.boolean(),
  proxy: z.boolean(),
  webRtcPolicy: z.boolean(),
});
export type KernelCapabilities = z.infer<typeof kernelCapabilitiesSchema>;

export const kernelPackageSchema = z.object({
  url: z.string().url().optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  sizeBytes: z.number().int().positive().optional(),
});

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
});
export type KernelManifest = z.infer<typeof kernelManifestSchema>;

export const browserLanguageSchema = z.string().trim().refine((value) => {
  if (value === "system") return true;
  try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; }
}, "Invalid browser language");

export const browserTimezoneSchema = z.string().trim().refine((value) => {
  if (value === "system") return true;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return value.length > 0; } catch { return false; }
}, "Invalid timezone");

const browserWindowSchema = z.object({
  width: z.number().int().min(640).max(7680),
  height: z.number().int().min(480).max(4320),
}).strict();

export const commonEnvironmentConfigSchema = z.object({
  language: browserLanguageSchema.default("zh-CN"),
  timezone: browserTimezoneSchema.default("Asia/Shanghai"),
  userAgent: z.string().trim().min(1).optional(),
  platform: z.string().trim().min(1).optional(),
  window: browserWindowSchema
    .extend({
      width: browserWindowSchema.shape.width.default(1440),
      height: browserWindowSchema.shape.height.default(900),
    })
    .default({ width: 1440, height: 900 }),
  hardwareConcurrency: z.number().int().min(1).max(256).default(8),
  webRtcPolicy: z.enum(["proxy", "disable", "default"]).default("proxy"),
  dnsPolicy: z.enum(["proxy", "system"]).default("proxy"),
});
export type CommonEnvironmentConfig = z.infer<
  typeof commonEnvironmentConfigSchema
>;
export const defaultCommonEnvironmentConfig =
  commonEnvironmentConfigSchema.parse({});

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
});
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;

export const createEnvironmentInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kernelId: z.string().trim().min(1),
  proxyId: z.string().trim().min(1).optional(),
  proxy: proxyConfigSchema.optional(),
  commonConfig: commonEnvironmentConfigSchema.default(
    defaultCommonEnvironmentConfig,
  ),
  kernelConfig: z.record(z.string(), z.unknown()).default({}),
});
export type CreateEnvironmentInput = z.infer<
  typeof createEnvironmentInputSchema
>;

export const browserSettingsSchema = z.object({
  language: browserLanguageSchema,
  timezone: browserTimezoneSchema,
  window: browserWindowSchema,
}).strict();
export type BrowserSettings = z.infer<typeof browserSettingsSchema>;
export const environmentIdSchema = z.string().trim().min(1);

// Editing preserves the kernel, profile directory, and configuration not exposed by the form.
export const updateEnvironmentInputSchema = z
  .object({
    version: z.literal(1),
    environmentId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(80),
    proxyId: z.string().trim().min(1).nullable(),
    browserSettings: browserSettingsSchema,
  })
  .strict();
export type UpdateEnvironmentInput = z.infer<
  typeof updateEnvironmentInputSchema
>;

export const proxySummarySchema = proxyConfigSchema.omit({ credentialRef: true }).extend({
  proxyId: z.string().min(1),
  hasPassword: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProxySummary = z.infer<typeof proxySummarySchema>;

export const saveProxyInputSchema = z.object({
  proxyId: z.string().trim().min(1).optional(),
  config: proxyConfigSchema.omit({ credentialRef: true }),
  password: z.string().min(1).optional(),
  clearPassword: z.boolean().optional(),
}).superRefine((input, ctx) => {
  if (input.password && !input.config.username)
    ctx.addIssue({ code: "custom", path: ["config", "username"], message: "Username is required for a password" });
  if (input.password && input.clearPassword)
    ctx.addIssue({ code: "custom", path: ["password"], message: "Cannot set and clear a password together" });
  if (input.config.type === "socks5" && (input.config.username || input.password))
    ctx.addIssue({ code: "custom", path: ["config", "username"], message: "Authenticated SOCKS5 is not supported by this runtime" });
});
export type SaveProxyInput = z.infer<typeof saveProxyInputSchema>;

export * from "./theme";

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
});
export type EnvironmentSummary = z.infer<typeof environmentSummarySchema>;

// Safe editor projection: no profile paths, credentials, or kernel-private configuration.
export const environmentDetailsSchema = environmentSummarySchema.extend({
  browserSettings: browserSettingsSchema,
}).strict();
export type EnvironmentDetails = z.infer<typeof environmentDetailsSchema>;

export function ipcResultSchema<T>(data: z.ZodType<T>) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
  ]);
}

export const runtimeSessionSchema = z.object({
  sessionId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  pid: z.number().int().positive(),
  controlPort: z.number().int().min(1).max(65535),
  startedAt: z.string().datetime(),
  status: z.enum(["starting", "running", "stopping", "stopped", "crashed"]),
});
export type RuntimeSession = z.infer<typeof runtimeSessionSchema>;

export const activitySummarySchema = runtimeSessionSchema.omit({ pid: true, controlPort: true }).extend({
  environmentName: z.string().optional(),
  exitReason: z.string().nullable(),
});
export type ActivitySummary = z.infer<typeof activitySummarySchema>;


export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; code: string; message: string };

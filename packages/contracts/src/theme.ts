import { z } from "zod";

export const themeModeSchema = z.enum(["light", "dark", "system"]);
export type ThemeMode = z.infer<typeof themeModeSchema>;
export const themeColorSchema = z
  .string()
  .regex(/^#[\da-f]{6}$/i)
  .transform((hex) => hex.toUpperCase());
export const themeRadiusSchema = z.enum([
  "default",
  "none",
  "sm",
  "md",
  "lg",
  "xl",
]);
export type ThemeRadius = z.infer<typeof themeRadiusSchema>;
export const themeDensitySchema = z.enum([
  "compact",
  "default",
  "comfortable",
  "spacious",
]);
export type ThemeDensity = z.infer<typeof themeDensitySchema>;
export const themeFontSchema = z.enum(["default", "sans", "serif"]);
export type ThemeFont = z.infer<typeof themeFontSchema>;
export const themeSidebarSchema = z.enum(["sidebar", "inset", "floating"]);
export type ThemeSidebar = z.infer<typeof themeSidebarSchema>;
export const themeLayoutSchema = z.enum(["default", "icon", "offcanvas"]);
export type ThemeLayout = z.infer<typeof themeLayoutSchema>;
export const themeContentWidthSchema = z.enum(["full", "centered"]);
export type ThemeContentWidth = z.infer<typeof themeContentWidthSchema>;
export const themeDirectionSchema = z.enum(["ltr", "rtl"]);
export type ThemeDirection = z.infer<typeof themeDirectionSchema>;
export const themeMotionSchema = z.enum(["system", "reduced"]);
export type ThemeMotion = z.infer<typeof themeMotionSchema>;
export const themeScaleSchema = z.union([
  z.literal(90),
  z.literal(100),
  z.literal(110),
  z.literal(125),
]);
export type ThemeScale = z.infer<typeof themeScaleSchema>;

export const themeConfigSchema = z.object({
  version: z.literal(2),
  mode: themeModeSchema,
  color: themeColorSchema,
  font: themeFontSchema,
  radius: themeRadiusSchema,
  density: themeDensitySchema,
  sidebar: themeSidebarSchema,
  layout: themeLayoutSchema,
  contentWidth: themeContentWidthSchema.default("full"),
  direction: themeDirectionSchema.default("ltr"),
  scale: themeScaleSchema.default(100),
  motion: themeMotionSchema.default("system"),
});
export type ThemeConfig = z.infer<typeof themeConfigSchema>;
export type ThemePreferences = Omit<ThemeConfig, "version">;

export const defaultThemeConfig: ThemeConfig = {
  version: 2,
  mode: "system",
  color: "#2563EB",
  font: "default",
  radius: "default",
  density: "default",
  sidebar: "sidebar",
  layout: "default",
  contentWidth: "full",
  direction: "ltr",
  scale: 100,
  motion: "system",
};

// Legacy values exist only at the migration boundary, never in the settings UI.
const legacyThemeSchema = z.object({
  version: z.literal(1),
  mode: themeModeSchema,
  preset: z.enum(["signal-weave", "graphite", "ocean", "amber"]),
  radius: z.enum(["none", "sm", "md", "lg", "xl"]),
  density: z.enum(["compact", "comfortable", "spacious"]),
  font: z.enum(["geist", "system", "serif", "mono"]),
  sidebarLayout: z.enum(["sidebar", "inset", "floating", "offcanvas"]),
  contentWidth: themeContentWidthSchema.default("full"),
  direction: themeDirectionSchema.default("ltr"),
});
const legacyColors = {
  "signal-weave": "#0891B2",
  graphite: "#71717A",
  ocean: "#2563EB",
  amber: "#D97706",
} as const;

/** Read saved settings permissively; IPC writes must use themeConfigSchema directly. */
export function readThemeConfig(input: unknown): ThemeConfig {
  const current = themeConfigSchema.safeParse(input);
  if (current.success) return current.data;
  const legacy = legacyThemeSchema.safeParse(input);
  if (!legacy.success) return { ...defaultThemeConfig };
  const previous = legacy.data;
  return {
    ...defaultThemeConfig,
    mode: previous.mode,
    color: legacyColors[previous.preset],
    radius: previous.radius === "md" ? "default" : previous.radius,
    font:
      previous.font === "serif"
        ? "serif"
        : previous.font === "system"
          ? "sans"
          : "default",
    density:
      previous.density === "comfortable"
        ? "default"
        : previous.density === "spacious"
          ? "comfortable"
          : "compact",
    sidebar:
      previous.sidebarLayout === "offcanvas"
        ? "sidebar"
        : previous.sidebarLayout,
    layout: previous.sidebarLayout === "offcanvas" ? "offcanvas" : "default",
    contentWidth: previous.contentWidth,
    direction: previous.direction,
  };
}

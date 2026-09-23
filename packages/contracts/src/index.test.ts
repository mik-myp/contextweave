import { describe, expect, it } from "vitest";
import {
  commonEnvironmentConfigSchema,
  createEnvironmentInputSchema,
  environmentConfigSchema,
  updateEnvironmentInputSchema,
  proxyConfigSchema,
  defaultThemeConfig,
  readThemeConfig,
  themeConfigSchema,
} from "./index";

describe("contracts", () => {
  it("fills safe defaults for a common environment configuration", () => {
    expect(commonEnvironmentConfigSchema.parse({})).toEqual({
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      window: { width: 1440, height: 900 },
      hardwareConcurrency: 8,
      webRtcPolicy: "proxy",
      dnsPolicy: "proxy",
    });
  });

  it("rejects malformed proxy ports", () => {
    expect(
      proxyConfigSchema.safeParse({
        type: "http",
        host: "127.0.0.1",
        port: 70000,
      }).success,
    ).toBe(false);
  });

  it("normalizes a complete environment input into a versioned config", () => {
    const input = createEnvironmentInputSchema.parse({
      name: "美国店铺",
      kernelId: "standard-chromium",
      commonConfig: { language: "en-US", timezone: "America/Los_Angeles" },
    });
    const config = environmentConfigSchema.parse({
      environmentId: "env-test",
      name: input.name,
      kernelId: input.kernelId,
      kernelVersion: "local",
      commonConfig: input.commonConfig,
      kernelConfig: input.kernelConfig,
    });

    expect(config.configVersion).toBe(1);
    expect(config.commonConfig.window.width).toBe(1440);
    expect(config.kernelConfig).toEqual({});
  });

  it("keeps theme preferences versioned and validates supported axes", () => {
    expect(defaultThemeConfig.contentWidth).toBe("full");
    expect(readThemeConfig(null).contentWidth).toBe("full");
    expect(themeConfigSchema.parse(defaultThemeConfig)).toEqual(
      defaultThemeConfig,
    );
    expect(
      themeConfigSchema.safeParse({ ...defaultThemeConfig, radius: "rounder" })
        .success,
    ).toBe(false);
    expect(
      themeConfigSchema.parse({
        ...defaultThemeConfig,
        contentWidth: undefined,
        direction: undefined,
      }),
    ).toEqual(defaultThemeConfig);
  });

  it.each([undefined, "full", "centered"] as const)(
    "uses full width when missing and preserves saved width %s",
    (contentWidth) => {
      const expected = contentWidth ?? "full";
      expect(
        readThemeConfig({ ...defaultThemeConfig, contentWidth }).contentWidth,
      ).toBe(expected);
      expect(
        readThemeConfig({
          version: 1,
          mode: "system",
          preset: "ocean",
          radius: "md",
          density: "comfortable",
          font: "system",
          sidebarLayout: "sidebar",
          contentWidth,
        }).contentWidth,
      ).toBe(expected);
    },
  );

  it("requires the complete editable projection without accepting privileged fields", () => {
    const input = {
      version: 1,
      environmentId: "env-test",
      name: "新的名称",
      proxyId: null,
      browserSettings: { language: "system", timezone: "UTC", window: { width: 1440, height: 900 } },
    };
    expect(updateEnvironmentInputSchema.parse(input)).toEqual(input);
    expect(updateEnvironmentInputSchema.safeParse({ ...input, version: undefined }).success).toBe(false);
    expect(updateEnvironmentInputSchema.safeParse({ ...input, browserSettings: undefined }).success).toBe(false);
    expect(updateEnvironmentInputSchema.safeParse({ ...input, kernelId: "other" }).success).toBe(false);
    for (const browserSettings of [
      {},
      { ...input.browserSettings, language: undefined },
      { ...input.browserSettings, window: { width: 1440 } },
      { ...input.browserSettings, window: { width: 1440, height: 900, unknown: true } },
      { ...input.browserSettings, language: "not a language" },
      { ...input.browserSettings, timezone: "Mars/Olympus" },
      { ...input.browserSettings, window: { width: 0, height: 900 } },
      { ...input.browserSettings, userAgent: "unexpected" },
    ]) {
      expect(updateEnvironmentInputSchema.safeParse({ ...input, browserSettings }).success).toBe(false);
    }
  });

  it.each([
    ["geist", "default"],
    ["mono", "default"],
    ["system", "sans"],
    ["serif", "serif"],
  ] as const)(
    "migrates v1 %s font and other preferences to v2",
    (font, expectedFont) => {
      expect(
        readThemeConfig({
          version: 1,
          mode: "dark",
          preset: "ocean",
          radius: "md",
          density: "comfortable",
          font,
          sidebarLayout: "offcanvas",
          contentWidth: "full",
          direction: "rtl",
        }),
      ).toMatchObject({
        version: 2,
        mode: "dark",
        color: "#2563EB",
        radius: "default",
        density: "default",
        font: expectedFont,
        sidebar: "sidebar",
        layout: "offcanvas",
        contentWidth: "full",
        direction: "rtl",
      });
    },
  );
});

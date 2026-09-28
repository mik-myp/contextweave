import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  releaseSections,
  validateReleaseNotes,
  readReleaseNotes,
} from "./release-notes.mjs";

const version = "0.2.7";
const valid =
  `# ContextWeave v${version} · 用户体验收敛\n\n说明\n\n` +
  releaseSections
    .map((name) => `## ${name}\n\n- 已核验的具体内容。\n`)
    .join("\n");

test("accepts structured Chinese notes and normalizes Windows line endings", () => {
  assert.equal(
    validateReleaseNotes(valid, version).title,
    "ContextWeave v0.2.7 · 用户体验收敛",
  );
  assert.equal(
    validateReleaseNotes(valid.replaceAll("\n", "\r\n"), version).body,
    valid,
  );
});
test("rejects wrong versions, missing topics and unfilled placeholders", () => {
  assert.throws(
    () => validateReleaseNotes(valid, "../0.2.7"),
    /INVALID_RELEASE_VERSION/,
  );
  assert.throws(
    () => validateReleaseNotes(valid.replace("v0.2.7", "v0.2.6"), version),
    /TITLE_INVALID/,
  );
  assert.throws(
    () => validateReleaseNotes(valid.replace(" · 用户体验收敛", ""), version),
    /TITLE_INVALID/,
  );
  for (const placeholder of ["TODO", "TBD", "待填写", "待补充"])
    assert.throws(
      () => validateReleaseNotes(`${valid}\n${placeholder}`, version),
      /PLACEHOLDER/,
    );
});
test("requires every section once, in order, with actual content", () => {
  assert.throws(
    () =>
      validateReleaseNotes(valid.replace("## 已知限制", "## 限制"), version),
    /SECTIONS_INVALID/,
  );
  assert.throws(
    () => validateReleaseNotes(`${valid}\n## 主要变化\n重复`, version),
    /SECTIONS_INVALID/,
  );
  assert.throws(
    () =>
      validateReleaseNotes(
        valid.replace("## 已知限制\n\n- 已核验的具体内容。", "## 已知限制\n"),
        version,
      ),
    /SECTION_EMPTY/,
  );
  assert.throws(
    () =>
      validateReleaseNotes(
        valid
          .replace("## 主要变化", "## 下载与安装")
          .replace("## 升级与兼容", "## 主要变化"),
        version,
      ),
    /SECTIONS_INVALID/,
  );
});
test("current workspace notes match the application manifests and reject another tag", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const current = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
  assert.match(
    readReleaseNotes(root, `v${current}`).title,
    new RegExp(`^ContextWeave v${current.replaceAll(".", "\\.")} · `),
  );
  assert.throws(
    () => readReleaseNotes(root, "v999.0.0"),
    /TAG_VERSION_MISMATCH/,
  );
});
test("publish consumes validated notes without giving the write job build or scan duties", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));
  assert.match(workflow, /node scripts\/release-notes.mjs check/);
  assert.match(workflow, /name: notes-\$\{\{ github.ref_name \}\}/);
  assert.match(publish, /--notes-file "\$notes"/);
  assert.doesNotMatch(
    publish,
    /--generate-notes|pnpm |actions\/checkout|sbom-action/,
  );
  const ci = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const build = readFileSync(
    new URL("../.github/workflows/build-desktop.yml", import.meta.url),
    "utf8",
  );
  assert.match(ci, /pull_request:/);
  assert.doesNotMatch(ci, /\n  push:/);
  assert.match(build, /\n  push:/);
  for (const gate of [
    "pnpm check",
    "test:desktop --require-native",
    "test:packaged-native",
    "test:packaged-fuses",
  ])
    assert.ok(build.includes(gate), gate);
});

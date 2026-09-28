import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyVersions, releaseTagFromEnvironment } from "./release-tools.mjs";

export const releaseSections = [
  "主要变化",
  "升级与兼容",
  "下载与安装",
  "验证范围",
  "已知限制",
  "后续计划",
];

export function validateReleaseNotes(body, version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("INVALID_RELEASE_VERSION");
  const lines = body.replaceAll("\r\n", "\n").trim().split("\n");
  const prefix = `# ContextWeave v${version} · `;
  if (
    !lines[0]?.startsWith(prefix) ||
    !lines[0].slice(prefix.length).trim() ||
    lines[0].length > 120
  )
    throw new Error("RELEASE_NOTES_TITLE_INVALID");
  if (/\b(TODO|TBD|PLACEHOLDER)\b|待填写|待补充|<填写/i.test(body))
    throw new Error("RELEASE_NOTES_PLACEHOLDER");
  const headings = lines.flatMap((line, index) =>
    line.startsWith("## ") ? [{ line, index }] : [],
  );
  if (
    headings.length !== releaseSections.length ||
    headings.some(({ line }, index) => line !== `## ${releaseSections[index]}`)
  )
    throw new Error("RELEASE_NOTES_SECTIONS_INVALID");
  for (const [index, heading] of headings.entries()) {
    const content = lines.slice(
      heading.index + 1,
      headings[index + 1]?.index ?? lines.length,
    );
    if (!content.some((line) => line.trim() && !line.startsWith("<!--")))
      throw new Error("RELEASE_NOTES_SECTION_EMPTY");
  }
  return { title: lines[0].slice(2), body: `${lines.join("\n")}\n` };
}

export function readReleaseNotes(root, tag) {
  const version = verifyVersions(root, tag);
  return validateReleaseNotes(
    readFileSync(join(root, "docs", "releases", `v${version}.md`), "utf8"),
    version,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, tag] = process.argv.slice(2);
    if (command !== "check")
      throw new Error("Usage: node scripts/release-notes.mjs check [tag]");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const { title } = readReleaseNotes(
      root,
      tag ?? releaseTagFromEnvironment(process.env),
    );
    console.log(`Release notes verified: ${title}`);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "RELEASE_NOTES_FAILED",
    );
    process.exitCode = 1;
  }
}

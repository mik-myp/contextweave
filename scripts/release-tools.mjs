import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'))
const asar = desktopRequire('@electron/asar')
const targets = {
  'windows-x64': { platform: 'win32', arch: 'x64', os: 'win' },
  'macos-x64': { platform: 'darwin', arch: 'x64', os: 'mac' },
  'macos-arm64': { platform: 'darwin', arch: 'arm64', os: 'mac' },
}
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
export function getTarget(name) {
  if (!Object.hasOwn(targets, name)) throw new Error('UNSUPPORTED_BUILD_TARGET')
  return targets[name]
}
export function verifyVersions(repositoryRoot, tag) {
  const packageFiles = [
    'package.json',
    'apps/desktop/package.json',
    ...readdirSync(join(repositoryRoot, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/package.json`),
  ]
  const version = readJson(join(repositoryRoot, 'package.json')).version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error('INVALID_APP_VERSION')
  if (tag !== undefined && tag !== `v${version}`) throw new Error('TAG_VERSION_MISMATCH')
  for (const file of packageFiles)
    if (readJson(join(repositoryRoot, file)).version !== version)
      throw new Error(`WORKSPACE_VERSION_MISMATCH: ${file}`)
  return version
}
export function expectedArtifacts(version, target) {
  const { os, arch } = getTarget(target)
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('INVALID_APP_VERSION')
  const prefix = `ContextWeave-${version}-${os}-${arch}`
  return os === 'win'
    ? [`${prefix}-setup.exe`, `${prefix}-portable.exe`]
    : [`${prefix}.dmg`, `${prefix}.zip`]
}
export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
function findAsar(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...findAsar(path))
    else if (entry.isFile() && entry.name === 'app.asar') found.push(path)
  }
  return found
}
export function findPackagedArchive(directory) {
  const archives = findAsar(directory)
  if (archives.length !== 1) throw new Error('EXPECTED_SINGLE_ASAR')
  return archives[0]
}
export function releaseTagFromEnvironment(env) {
  return env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : undefined
}
export async function auditPackage(archive, target, expectedVersion) {
  const { platform, arch } = getTarget(target)
  if (!lstatSync(archive).isFile()) throw new Error('INVALID_ASAR_FILE')
  const app = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
  if (app.version !== expectedVersion) throw new Error('PACKAGED_VERSION_MISMATCH')
  if (typeof app.name !== 'string') throw new Error('INVALID_PACKAGED_MANIFEST')
  const files = []
  const packages = []
  for (const entry of asar.listPackage(archive)) {
    const internal = entry.replace(/^[\\/]+/, '')
    const path = internal.replaceAll('\\', '/')
    const info = asar.statFile(archive, internal)
    if (typeof info.size !== 'number') continue
    files.push({ path, bytes: info.size, unpacked: info.unpacked === true })
    if (!/^node_modules\/(?:.*\/)?package\.json$/.test(path)) continue
    if (info.size > 1024 * 1024) throw new Error('PACKAGED_MANIFEST_TOO_LARGE')
    const manifest = JSON.parse(asar.extractFile(archive, internal).toString('utf8'))
    // Package subpath markers often contain only { type: "module" }; they are not extra packages.
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') continue
    packages.push({
      name: manifest.name,
      version: manifest.version,
      path,
      license: typeof manifest.license === 'string' ? manifest.license : null,
    })
  }
  const required = [
    'dist/index.html',
    'dist-electron/main.js',
    'dist-electron/preload.cjs',
    'dist-electron/worker.js',
  ]
  for (const path of required)
    if (!files.some((file) => file.path === path))
      throw new Error(`MISSING_PACKAGED_ENTRY: ${path}`)
  const declaredRuntimeDependencies = app.dependencies ?? {}
  for (const name of Object.keys(declaredRuntimeDependencies))
    if (!packages.some((entry) => entry.path === `node_modules/${name}/package.json`))
      throw new Error(`MISSING_PACKAGED_DEPENDENCY: ${name}`)
  return {
    formatVersion: 1,
    scope: 'electron-asar-inventory-not-full-sbom',
    application: { name: app.name, version: app.version, platform, arch },
    sourceCommit: process.env.GITHUB_SHA ?? null,
    asar: { bytes: statSync(archive).size, sha256: await sha256File(archive) },
    contentBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    fileCount: files.length,
    declaredRuntimeDependencies,
    packages: packages.sort((a, b) => a.path.localeCompare(b.path)),
    bundledEntries: files.filter((file) => /^(dist|dist-electron)\//.test(file.path)),
    largestFiles: files
      .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
      .slice(0, 20),
    limitations: [
      'Does not enumerate every component of the Electron executable or OS frameworks.',
      'Renderer and workspace modules bundled into JavaScript are not separate node_modules packages.',
      'Source SPDX describes source dependencies; this report describes ASAR contents. Neither is asserted to be a complete binary SBOM.',
    ],
  }
}
export async function stageArtifacts({ versionRoot, destination, target, version }) {
  const names = expectedArtifacts(version, target)
  if (existsSync(destination)) throw new Error('ARTIFACT_OUTPUT_EXISTS')
  for (const name of names) {
    const path = join(versionRoot, name)
    if (!lstatSync(path).isFile() || statSync(path).size === 0)
      throw new Error(`MISSING_INSTALLER: ${name}`)
  }
  const inventory = await auditPackage(findPackagedArchive(versionRoot), target, version)
  // Publish the inventory together with installers, and include all three files in this platform's hash list.
  mkdirSync(destination, { recursive: true })
  for (const name of names) copyFileSync(join(versionRoot, name), join(destination, name))
  const inventoryName = `contextweave-packaged-${target}.json`
  writeFileSync(join(destination, inventoryName), `${JSON.stringify(inventory, null, 2)}\n`)
  const lines = []
  for (const name of [...names, inventoryName].sort())
    lines.push(`${await sha256File(join(destination, name))}  ${name}`)
  writeFileSync(join(destination, `SHA256SUMS-${target}.txt`), `${lines.join('\n')}\n`)
  return [...names, inventoryName, `SHA256SUMS-${target}.txt`]
}
async function main() {
  const [command, targetOrTag, explicitDestination] = process.argv.slice(2)
  if (command === 'check-version') {
    console.log(
      `Workspace versions verified: ${verifyVersions(root, targetOrTag ?? releaseTagFromEnvironment(process.env))}`,
    )
    return
  }
  if (command === 'stage' && targetOrTag) {
    const target = targetOrTag
    getTarget(target)
    const version = verifyVersions(root)
    const destination = explicitDestination
      ? resolve(explicitDestination)
      : join(root, 'release-artifacts', target)
    const names = await stageArtifacts({
      versionRoot: join(root, 'apps/desktop/release', version),
      destination,
      target,
      version,
    })
    console.log(
      `Staged ${names.length} verified files in ${relative(root, destination)} (${basename(destination)})`,
    )
    return
  }
  throw new Error(
    'Usage: node scripts/release-tools.mjs check-version [tag] | stage <target> [destination]',
  )
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'RELEASE_TOOL_FAILED')
    process.exitCode = 1
  })

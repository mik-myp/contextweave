import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/desktop')
const require = createRequire(resolve(desktop, 'package.json'))
const { ESLint } = require('eslint')
const eslint = new ESLint({ cwd: desktop })
const messages = async (source, filePath = 'src/lint-fixture.tsx') =>
  (await eslint.lintText(source, { filePath }))[0].messages

test('flat config covers every desktop TS/TSX boundary, including tests and build config', async () => {
  for (const file of [
    'src/app/lint-fixture.tsx',
    'src/features/lint-fixture.test.tsx',
    'electron/services/lint-fixture.ts',
    'electron/worker/lint-fixture.test.ts',
    'electron.vite.config.ts',
    'vitest.config.ts',
  ]) {
    const result = await messages('export const unsafe: any = 1', file)
    assert(
      result.some(({ ruleId }) => ruleId === '@typescript-eslint/no-explicit-any'),
      file,
    )
  }
  const manifest = JSON.parse(await readFile(resolve(desktop, 'package.json'), 'utf8'))
  assert.match(manifest.scripts.lint, /"\*\*\/\*\.\{ts,tsx\}"/)
  assert.match(manifest.scripts.lint, /--max-warnings 0/)
  assert.match(manifest.scripts.lint, /--report-unused-disable-directives/)
})

test('generated outputs alone stay excluded; nearby feature and route code stays checked', async () => {
  for (const file of ['dist/a.ts', 'dist-electron/a.ts', 'release/a.tsx', 'src/routeTree.gen.ts']) {
    assert.equal(await eslint.isPathIgnored(resolve(desktop, file)), true, file)
  }
  for (const file of [
    'src/routes/__root.tsx',
    'src/features/release/a.ts',
    'src/app/app-shell.tsx',
  ]) {
    assert.equal(await eslint.isPathIgnored(resolve(desktop, file)), false, file)
  }
})

test('recommended Hooks rules reject conditional hooks, render refs and synchronous effect state', async () => {
  const fixtures = [
    [
      'rules-of-hooks',
      `import { useState } from 'react'; export function Example({ enabled }) {
      if (enabled) useState(0); return null
    }`,
    ],
    [
      'refs',
      `import { useRef } from 'react'; export function Example() {
      const ref = useRef(0); return <p>{ref.current}</p>
    }`,
    ],
    [
      'set-state-in-effect',
      `import { useEffect, useState } from 'react'; export function Example({ name }) {
      const [value, setValue] = useState(name); useEffect(() => { setValue(name) }, [name]); return <p>{value}</p>
    }`,
    ],
  ]
  for (const [rule, source] of fixtures) {
    assert(
      (await messages(source)).some(({ ruleId }) => ruleId === `react-hooks/${rule}`),
      rule,
    )
  }
})

test('refresh stays enforced in feature and route modules with only the existing UI export exception', async () => {
  const source = 'export const helper = () => 1; export function Example() { return <p /> }'
  for (const file of ['src/features/fixture.tsx', 'src/routes/fixture.tsx']) {
    assert(
      (await messages(source, file)).some(
        ({ ruleId }) => ruleId === 'react-refresh/only-export-components',
      ),
    )
  }
  const uiFile = 'src/components/ui/fixture.tsx'
  assert(
    !(await messages(source, uiFile)).some(
      ({ ruleId }) => ruleId === 'react-refresh/only-export-components',
    ),
  )
  const config = await eslint.calculateConfigForFile(resolve(desktop, uiFile))
  assert.equal(config.rules['react-hooks/rules-of-hooks'][0], 2)
  assert.equal(config.rules['@typescript-eslint/no-explicit-any'][0], 2)
})

test('error cause preservation and unused-disable detection stay enabled', async () => {
  const thrown = await messages(
    'export function run() { try { throw new Error("first") } catch (cause) { throw new Error("lost") } }',
  )
  assert(thrown.some(({ ruleId }) => ruleId === 'preserve-caught-error'))
  const result = await messages('// eslint-disable-next-line no-debugger\nexport const value = 1')
  assert(result.some(({ message }) => message.includes('Unused eslint-disable directive')))
})

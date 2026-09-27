// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  environmentDetailsSchema,
  environmentCommandReceiptSchema,
  type EnvironmentCommandRequest,
} from '@contextweave/contracts'
import { createEnvironmentService } from '../environment-service'
import { createEnvironmentCommandClient } from './command-client'
import { createWorkspaceApi } from '@/features/workspaces/workspace-api'
import { environmentFormDefaults } from '../environment-form'
import { fixtureWorkspace, withWorkspaceFixture } from '../../../../test-support/workspace'

const at = '2026-01-01T00:00:00.000Z'
const details = environmentDetailsSchema.parse({
  ...fixtureWorkspace,
  id: 'env-service',
  name: 'Fixture',
  kernelId: 'standard-chromium',
  kernelVersion: 'local',
  status: 'stopped',
  revision: 4,
  platform: 'darwin',
  arch: 'arm64',
  updatedAt: at,
  browserSettings: { language: 'system', timezone: 'system', window: { width: 1440, height: 900 } },
})
afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})
function fixture() {
  const legacy = vi.fn(() => {
    throw new Error('Renderer must use stable command identity')
  })
  const submit = vi.fn(async (input: EnvironmentCommandRequest) => {
    const target = input.kind === 'create' ? null : input.kind === 'update' ? input.input : input
    return {
      ok: true,
      data: environmentCommandReceiptSchema.parse({
        ...fixtureWorkspace,
        version: 1,
        requestId: input.requestId,
        kind: input.kind,
        environmentId: target?.environmentId ?? details.id,
        expectedRevision: target?.expectedRevision ?? null,
        status: 'succeeded',
        createdAt: at,
        startedAt: at,
        endedAt: at,
        errorCode: null,
      }),
    }
  })
  const get = vi.fn(async () => ({ ok: true, data: details }))
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({
      environment: {
        submitCommand: submit,
        commandReceipt: legacy,
        get,
        create: legacy,
        update: legacy,
        start: legacy,
        stop: legacy,
        delete: legacy,
        restore: legacy,
        recover: legacy,
      },
    }),
  )
  const api = createWorkspaceApi(fixtureWorkspace)
  const client = createEnvironmentCommandClient({
    context: fixtureWorkspace,
    api: api.environment,
    storage: window.localStorage,
  })
  return { submit, get, legacy, client, service: createEnvironmentService(api, client) }
}
it('routes every UI mutation through a single stable request and rereads public details after success', async () => {
  const f = fixture(),
    values = { ...environmentFormDefaults(), name: 'Fixture', kernelId: 'standard-chromium' }
  await f.service.save(values)
  await f.service.save(values, details.id, 4)
  await f.service.start(details.id, 4)
  await f.service.stop(details.id, 4)
  const trashed = await f.service.delete(details.id, 4)
  expect(trashed.kind).toBe('trash')
  await f.service.restore(details.id, 4)
  await f.service.recover(details.id, 4)
  const requests = f.submit.mock.calls.map(([value]) => value)
  expect(requests.map((value) => value.kind)).toEqual([
    'create',
    'update',
    'start',
    'stop',
    'trash',
    'restore',
    'recover',
  ])
  expect(new Set(requests.map((value) => value.requestId)).size).toBe(7)
  expect(requests[1]).toMatchObject({ input: { environmentId: details.id, expectedRevision: 4 } })
  for (const request of requests.slice(2)) expect(request).toMatchObject({ expectedRevision: 4 })
  expect(f.get).toHaveBeenCalledTimes(6)
  expect(f.get).toHaveBeenLastCalledWith(details.id)
  expect(f.legacy).not.toHaveBeenCalled()
})
it('fails closed when a legacy summary has no revision instead of silently targeting the latest configuration', async () => {
  const f = fixture()
  await expect(f.service.start(details.id, undefined)).rejects.toThrow()
  await expect(f.service.stop(details.id, undefined)).rejects.toThrow()
  await expect(f.service.save(environmentFormDefaults(details), details.id)).rejects.toThrow()
  expect(f.submit).not.toHaveBeenCalled()
  expect(f.legacy).not.toHaveBeenCalled()
})

it('retains the original successful creation when its follow-up detail read is lost, blocking duplicate creation', async () => {
  const f = fixture(),
    values = { ...environmentFormDefaults(), name: 'Fixture', kernelId: 'standard-chromium' }
  f.get.mockRejectedValue(new Error('details reply lost'))
  await expect(f.service.save(values)).rejects.toThrow('结果尚未确认')
  const original = f.submit.mock.calls[0][0].requestId
  expect(f.client.getSnapshot().entries[0]?.requestId).toBe(original)
  await expect(f.service.save({ ...values, name: 'changed form' })).rejects.toMatchObject({
    requestId: original,
  })
  expect(f.submit).toHaveBeenCalledOnce()
  expect(f.legacy).not.toHaveBeenCalled()
})

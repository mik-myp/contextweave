import { describe, expect, it } from 'vitest'
import {
  organizationNameSchema,
  organizationNameKey,
  tagsSchema,
  environmentViewSchema,
  saveEnvironmentOrganizationSchema,
  organizationSnapshotSchema,
} from './organization'
const view = {
  version: 1,
  search: '',
  filters: { statuses: [], kernelIds: [], proxyIds: [], groupIds: [], tags: [] },
  sorting: [],
  hiddenColumns: [],
}
describe('organization contracts', () => {
  it('normalizes display labels without locale-dependent duplicate identities', () => {
    expect(organizationNameSchema.parse('  e\u0301quipe ')).toBe('équipe')
    expect(organizationNameKey(' ÉQUIPE ')).toBe(organizationNameKey('e\u0301quipe'))
    expect(organizationNameSchema.safeParse(' ').success).toBe(false)
    expect(organizationNameSchema.safeParse('x'.repeat(81)).success).toBe(false)
    expect(tagsSchema.parse([' Review ', '中文'])).toEqual(['Review', '中文'])
    for (const bad of [
      ['Review', 'review'],
      ['é', 'e\u0301'],
      Array(21).fill('x'),
      ['x'.repeat(41)],
    ])
      expect(tagsSchema.safeParse(bad).success).toBe(false)
  })
  it('does not accept arbitrary table state or runtime selections in named views', () => {
    expect(environmentViewSchema.parse(view)).toEqual(view)
    for (const extra of [
      { rowSelection: { 'secret-environment': true } },
      { cursor: 'secret' },
      { pagination: { pageIndex: 3 } },
    ])
      expect(environmentViewSchema.safeParse({ ...view, ...extra }).success).toBe(false)
    expect(environmentViewSchema.safeParse({ ...view, hiddenColumns: ['name'] }).success).toBe(
      false,
    )
    expect(
      environmentViewSchema.safeParse({ ...view, sorting: [{ id: 'arbitrary', desc: false }] })
        .success,
    ).toBe(false)
    expect(
      environmentViewSchema.safeParse({
        ...view,
        filters: { ...view.filters, statuses: ['arbitrary'] },
      }).success,
    ).toBe(false)
  })
  it('requires explicit optimistic revision and bounded non-secret annotation fields', () => {
    const valid = {
      environmentId: 'same-id',
      groupId: null,
      tags: [],
      note: '<script>plain text only</script>',
      expectedRevision: 0,
    }
    expect(saveEnvironmentOrganizationSchema.parse(valid)).toEqual(valid)
    expect(
      saveEnvironmentOrganizationSchema.safeParse({ ...valid, expectedRevision: undefined })
        .success,
    ).toBe(false)
    expect(
      saveEnvironmentOrganizationSchema.safeParse({ ...valid, note: 'x'.repeat(4001) }).success,
    ).toBe(false)
    expect(
      saveEnvironmentOrganizationSchema.safeParse({ ...valid, password: 'secret' }).success,
    ).toBe(false)
  })
  it('rejects mixed-owner organization snapshots', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001'
    const valid = {
      workspaceId,
      groups: [],
      tags: [],
      environments: [
        { workspaceId, environmentId: 'same-id', groupId: null, tags: [], note: '', revision: 0 },
      ],
      views: [],
    }
    expect(organizationSnapshotSchema.safeParse(valid).success).toBe(true)
    expect(
      organizationSnapshotSchema.safeParse({
        ...valid,
        environments: [
          { ...valid.environments[0], workspaceId: '00000000-0000-4000-8000-000000000002' },
        ],
      }).success,
    ).toBe(false)
  })
})

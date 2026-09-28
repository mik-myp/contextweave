import { organizationNameKey, type OrganizationSnapshot } from '@contextweave/contracts'

export function tagUsage(snapshot?: OrganizationSnapshot) {
  const environments = new Map<string, number>(),
    views = new Map<string, number>()
  for (const item of snapshot?.environments ?? [])
    for (const name of item.tags) {
      const key = organizationNameKey(name)
      environments.set(key, (environments.get(key) ?? 0) + 1)
    }
  for (const item of snapshot?.views ?? [])
    for (const key of item.view.filters.tags) views.set(key, (views.get(key) ?? 0) + 1)
  return { environments, views }
}

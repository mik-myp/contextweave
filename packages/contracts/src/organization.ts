import { z } from 'zod'
import { workspaceContextSchema } from './workspaces'
import { environmentStatusSchema } from './environment-status'

/** Locale-independent identity; labels retain their normalized display casing. */
export const organizationNameKey = (name: string) => name.trim().normalize('NFC').toLowerCase()
const label = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.normalize('NFC'))
    .pipe(z.string().min(1).max(max))
export const organizationNameSchema = label(80)
export const tagSchema = label(40)
export const tagsSchema = z
  .array(tagSchema)
  .max(20)
  .refine(
    (values) => new Set(values.map(organizationNameKey)).size === values.length,
    'Duplicate tags',
  )
const id = z.string().uuid()
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const metadataFields = {
  groupId: id.nullable(),
  tags: tagsSchema,
  note: z.string().max(4000),
}
export const environmentGroupSchema = workspaceContextSchema.extend({
  id,
  name: organizationNameSchema,
  revision,
  updatedAt: z.string().datetime(),
})
export const environmentTagSchema = workspaceContextSchema.extend({
  id,
  name: tagSchema,
  revision,
  updatedAt: z.string().datetime(),
})
export type EnvironmentTag = z.infer<typeof environmentTagSchema>
export const createTagSchema = z.strictObject({ name: tagSchema })
export const updateTagSchema = z.strictObject({ id, name: tagSchema, expectedRevision: revision })
export const deleteTagSchema = z.strictObject({ id, expectedRevision: revision })
export type EnvironmentGroup = z.infer<typeof environmentGroupSchema>
export const environmentOrganizationSchema = workspaceContextSchema.extend({
  environmentId: z.string().min(1),
  ...metadataFields,
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})
export type EnvironmentOrganization = z.infer<typeof environmentOrganizationSchema>
export const saveEnvironmentOrganizationSchema = z.strictObject({
  environmentId: z.string().trim().min(1),
  ...metadataFields,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})
export type SaveEnvironmentOrganization = z.infer<typeof saveEnvironmentOrganizationSchema>
export const createGroupSchema = z.strictObject({ name: organizationNameSchema })
export const reviseOrganizationItemSchema = z.strictObject({ id, expectedRevision: revision })
export const updateGroupSchema = reviseOrganizationItemSchema.extend({
  name: organizationNameSchema,
})
export const environmentViewColumnSchema = z.enum([
  'name',
  'status',
  'kernelId',
  'proxyId',
  'updatedAt',
  'groupId',
  'tags',
  'note',
])
const uniqueStrings = (schema: z.ZodType<string>, max: number) =>
  z
    .array(schema)
    .max(max)
    .refine((values) => new Set(values).size === values.length, 'Duplicate values')
export const environmentViewSchema = z.strictObject({
  version: z.literal(1),
  search: z.string().max(200),
  filters: z.strictObject({
    statuses: uniqueStrings(environmentStatusSchema, 8),
    kernelIds: uniqueStrings(z.string().min(1).max(256), 100),
    proxyIds: uniqueStrings(z.string().min(1).max(256), 100),
    groupIds: uniqueStrings(z.union([id, z.literal('ungrouped')]), 100),
    tags: uniqueStrings(tagSchema.transform(organizationNameKey), 100),
  }),
  sorting: z
    .array(z.strictObject({ id: environmentViewColumnSchema, desc: z.boolean() }))
    .max(8)
    .refine((values) => new Set(values.map((v) => v.id)).size === values.length),
  // The name, selection and action columns remain visible and are not preferences.
  hiddenColumns: uniqueStrings(environmentViewColumnSchema.exclude(['name']), 7),
})
export type EnvironmentView = z.infer<typeof environmentViewSchema>
export const savedEnvironmentViewSchema = workspaceContextSchema.extend({
  id,
  name: organizationNameSchema,
  view: environmentViewSchema,
  revision,
  updatedAt: z.string().datetime(),
})
export type SavedEnvironmentView = z.infer<typeof savedEnvironmentViewSchema>
export const createEnvironmentViewSchema = z.strictObject({
  name: organizationNameSchema,
  view: environmentViewSchema,
})
export const updateEnvironmentViewSchema = reviseOrganizationItemSchema.extend({
  name: organizationNameSchema,
  view: environmentViewSchema,
})
export const organizationSnapshotSchema = workspaceContextSchema
  .extend({
    groups: z.array(environmentGroupSchema),
    tags: z.array(environmentTagSchema),
    environments: z.array(environmentOrganizationSchema),
    views: z.array(savedEnvironmentViewSchema),
  })
  .refine(
    (snapshot) =>
      [...snapshot.groups, ...snapshot.tags, ...snapshot.environments, ...snapshot.views].every(
        (item) => item.workspaceId === snapshot.workspaceId,
      ),
    'Workspace mismatch',
  )
export type OrganizationSnapshot = z.infer<typeof organizationSnapshotSchema>

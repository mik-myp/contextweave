import type { tagMessages as zh } from './zh-CN-tags'
export const tagMessages: Record<keyof typeof zh, string> = {
  'nav.tags': 'Tags',
  'tags.title': 'Tag management',
  'tags.description':
    'Manage a shared tag dictionary, including unused tags. Environment counts include the trash. Tag changes never delete environments or browser data.',
  'tags.save': 'Save tag',
  'tags.actions': 'Actions',
  'tags.name': 'Tag name',
  'tags.nameHelp':
    'Use 1–40 characters. Names are unique ignoring surrounding spaces, case and equivalent Unicode spellings.',
  'tags.invalid': 'Enter a tag name with 1–40 characters.',
  'tags.create': 'New tag',
  'tags.createHelp':
    'Create a tag now and assign it later from any environment’s organization editor.',
  'tags.rename': 'Rename tag',
  'tags.renameHelp':
    'All environment associations (including the trash) and saved filters will update together.',
  'tags.delete': 'Delete tag',
  'tags.deleteHelp':
    'Remove this tag from all environments and remove its condition from saved filters (which may broaden their results). No environments or browser data will be deleted. This cannot be undone.',
  'tags.created': 'Tag created.',
  'tags.renamed': 'Tag and associations updated.',
  'tags.deleted': 'Tag and associations removed. Environments and browser data are unchanged.',
  'tags.search': 'Search tags…',
  'tags.environments': 'Environments',
  'tags.views': 'Saved filters',
  'tags.updatedAt': 'Updated',
  'tags.empty': 'No tags',
  'tags.emptyHelp': 'Create your first tag or adjust your search.',
  'tags.missing': 'This tag was deleted. Close the editor and refresh the list.',
  'tags.chooseExisting': 'Choose an existing tag',
  'tags.chooseHelp':
    'Uses the tag management dictionary, including unused tags. New names typed below will be registered when saved.',
}

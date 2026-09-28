import { createFileRoute } from '@tanstack/react-router'
import { TagsPage } from '@/features/environments/tags/tags-page'

export const Route = createFileRoute('/tags')({ component: TagsPage })

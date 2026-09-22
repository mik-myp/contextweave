import { createFileRoute } from '@tanstack/react-router'
import { KernelsPage } from '@/features/kernels/pages/kernels-page'

export const Route = createFileRoute('/kernels')({ component: KernelsPage })

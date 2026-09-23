import { createFileRoute } from '@tanstack/react-router'
import { FingerprintPage } from '@/features/fingerprints/pages/fingerprint-page'

export const Route = createFileRoute('/fingerprints')({ component: FingerprintPage })

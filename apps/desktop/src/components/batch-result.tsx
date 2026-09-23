import { useI18n } from '@/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { BatchFailure } from '@/shared/lib/batch'
export function BatchResult({ failures }: { failures: BatchFailure[] }) {
  const { t } = useI18n()
  if (!failures.length) return null
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {t('admin.partialFailure').replace('{count}', String(failures.length))}
      </AlertTitle>
      <AlertDescription>
        <ul className="max-h-36 overflow-auto">
          {failures.map((item) => (
            <li key={item.id}>
              {item.label} — {item.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

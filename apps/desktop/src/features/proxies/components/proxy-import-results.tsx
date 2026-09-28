import type { ImportProxiesResult } from '@contextweave/contracts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useI18n } from '@/i18n'

export function ProxyImportResults({ rows }: { rows: ImportProxiesResult }) {
  const { t } = useI18n()
  const failed = rows.filter((row) => row.status === 'error')
  return (
    <Alert>
      <AlertDescription>
        <p role="status">
          {t('proxy.import.summary')
            .replace('{created}', String(rows.filter((row) => row.status === 'created').length))
            .replace('{skipped}', String(rows.filter((row) => row.status === 'skipped').length))
            .replace('{failed}', String(failed.length))}
        </p>
        {failed.length > 0 && (
          <ul
            aria-label={t('proxy.import.failures')}
            className="max-h-40 overflow-y-auto break-all"
            tabIndex={0}
          >
            {failed.map((row) => (
              <li key={row.line}>
                {t('proxy.import.line').replace('{line}', String(row.line))}:{' '}
                {row.proxy ? (
                  <code>
                    {row.proxy.type && `${row.proxy.type}://`}
                    {row.proxy.hasCredentials && '***:***@'}
                    {row.proxy.host}:{row.proxy.port}
                  </code>
                ) : (
                  t('proxy.import.hidden')
                )}{' '}
                —{' '}
                {t(
                  row.code === 'CREDENTIAL_UNAVAILABLE'
                    ? 'proxy.import.secureUnavailable'
                    : row.code === 'PROXY_SAVE_FAILED'
                      ? 'proxy.import.saveFailed'
                      : 'proxy.import.invalid',
                )}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  )
}

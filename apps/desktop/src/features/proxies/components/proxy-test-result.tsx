import type { ProxyTestResult as TestResult } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { Badge } from '@/components/ui/badge'

export function ProxyTestResult({ result }: { result?: TestResult }) {
  const { t } = useI18n()
  if (!result) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={result.success ? 'success' : 'destructive'}>
        {t(result.success ? 'proxy.testSuccess' : 'proxy.testFailed')}
      </Badge>
      {result.exitIp && (
        <span className="font-mono text-xs" dir="ltr">
          {result.exitIp}
        </span>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">{result.latencyMs} ms</span>
      {result.success && result.connectivity === 'http' && (
        <span className="text-xs text-muted-foreground">{t('proxy.httpOnly')}</span>
      )}
      {result.success && result.exitIpUnavailable && (
        <span className="text-xs text-muted-foreground">{t('proxy.ipUnavailable')}</span>
      )}
      {result.errorCode && (
        <span className="text-xs text-muted-foreground">
          {t(
            result.errorCode === 'PROXY_TEST_TIMEOUT'
              ? 'proxy.testTimeout'
              : 'proxy.testFailedHelp',
          )}
        </span>
      )}
    </div>
  )
}

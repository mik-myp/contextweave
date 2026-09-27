import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { IpLocaleResult } from '@contextweave/contracts'
import { environmentService } from '../environment-service'

export function useIpLocale(connection: 'direct' | 'proxy', proxyId: string) {
  const route = connection === 'proxy' ? `proxy:${proxyId}` : 'direct'
  const currentRoute = useRef(route)
  const active = useRef<string | undefined>(undefined)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ route: string; value: IpLocaleResult }>()
  const [error, setError] = useState<{ route: string; message: string }>()
  const [displayRoute, setDisplayRoute] = useState(route)
  if (displayRoute !== route) {
    setDisplayRoute(route)
    setResult(undefined)
    setError(undefined)
  }
  const cancel = () => {
    const id = active.current
    if (!id) return
    active.current = undefined
    void environmentService.cancelLocale(id).catch(() => {})
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancel()
    }
  }, [])
  useLayoutEffect(() => {
    currentRoute.current = route
    cancel()
  }, [route])
  const detect = async () => {
    if (busy || active.current || (connection === 'proxy' && !proxyId)) return
    const requestId = crypto.randomUUID()
    active.current = requestId
    setBusy(true)
    setResult(undefined)
    setError(undefined)
    try {
      const value = await environmentService.detectLocale(
        connection === 'proxy' ? { requestId, connection, proxyId } : { requestId, connection },
      )
      if (mounted.current && active.current === requestId && currentRoute.current === route)
        setResult({ route, value })
    } catch (cause) {
      if (mounted.current && active.current === requestId && currentRoute.current === route)
        setError({ route, message: cause instanceof Error ? cause.message : 'IP_LOCALE_FAILED' })
    } finally {
      if (active.current === requestId) active.current = undefined
      if (mounted.current) setBusy(false)
    }
  }
  return {
    detect,
    cancel,
    busy,
    result: result?.route === route ? result.value : undefined,
    error: error?.route === route ? error.message : undefined,
  }
}

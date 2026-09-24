import { ipLocaleRequestSchema, ipLocaleCancelSchema } from '@contextweave/contracts'
import type { EnvironmentRepository } from '@contextweave/storage'
import type { CredentialStore } from './credentials'
import type { IpLocaleService } from './ip-locale'
import { openProxyTransport, type ProxyTransport } from './proxy-transport'

export function createIpLocalePreview(
  repository: Pick<EnvironmentRepository, 'getProxy'>,
  credentials: Pick<CredentialStore, 'read'>,
  locale: IpLocaleService,
) {
  let pending: { id: string; controller: AbortController; done: Promise<unknown> } | undefined
  let closing = false
  return {
    detect(input: unknown) {
      const request = ipLocaleRequestSchema.parse(input)
      if (closing) throw new Error('APP_CLOSING')
      if (pending) throw new Error('IP_LOCALE_BUSY')
      const controller = new AbortController()
      const done = (async () => {
        let transport: ProxyTransport | undefined
        try {
          if (request.connection === 'proxy') {
            const proxy = repository.getProxy(request.proxyId)
            if (!proxy) throw new Error('PROXY_MISSING')
            let password: string | undefined
            try {
              password = proxy.credentialRef ? credentials.read(proxy.credentialRef) : ''
            } catch {
              throw new Error('CREDENTIAL_UNAVAILABLE')
            }
            if (password === undefined) throw new Error('CREDENTIAL_UNAVAILABLE')
            transport = await openProxyTransport(proxy, password)
          }
          if (controller.signal.aborted) throw new Error('CANCELLED')
          return await locale.detect(transport?.authentication, controller.signal)
        } finally {
          await transport?.close()
        }
      })().finally(() => {
        pending = undefined
      })
      pending = { id: request.requestId, controller, done }
      return done
    },
    cancel(input: unknown) {
      const id = ipLocaleCancelSchema.parse(input)
      if (pending?.id !== id) return false
      pending.controller.abort()
      return true
    },
    async shutdown() {
      closing = true
      pending?.controller.abort()
      await pending?.done.catch(() => {})
    },
  }
}

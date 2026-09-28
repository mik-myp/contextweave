import { importProxyRowSchema, proxyTypeSchema } from '@contextweave/contracts'

/** Fail closed: malformed/ambiguous source text must never be echoed as a proxy label. */
export function redactProxyImportLine(line: string) {
  const text = line.trim()
  const scheme = /^([a-z0-9]+):\/\//i.exec(text)
  const protocol = (scheme?.[1] ?? 'http').toLowerCase()
  const type = proxyTypeSchema.safeParse(
    ['socket5', 'socks5h'].includes(protocol) ? 'socks5' : protocol,
  )
  const address = scheme ? text.slice(scheme[0].length) : text
  const endpoint = /^(\[[^\]]+\]|[^:@/?#\\]+):(\d+)\/?$/.exec(address)
  const legacy = /^(\[[^\]]+\]|[^:@/?#\\]+):(\d+):([^:]+):(.+)$/.exec(address)
  const uri = /^([^@/?#\\]+)@(\[[^\]]+\]|[^:@/?#\\]+):(\d+)\/?$/.exec(address)
  // Even a malformed URI can match legacy notation. Do not expose a username
  // as the host just because its URI suffix could not be parsed.
  if (legacy && address.includes('@')) return undefined
  const host = endpoint?.[1] ?? legacy?.[1] ?? uri?.[2]
  const port = endpoint?.[2] ?? legacy?.[2] ?? uri?.[3]
  if (!host || !port) return undefined
  const preview = importProxyRowSchema.shape.proxy.safeParse({
    type: type.success ? type.data : undefined,
    host,
    port: Number(port),
    hasCredentials: Boolean(legacy || uri),
  })
  return preview.success ? preview.data : undefined
}

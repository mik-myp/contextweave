import { describe, expect, it } from 'vitest'
import { importProxiesInputSchema, importProxiesResultSchema, parseProxyLine } from './index'

describe('proxy import format', () => {
  it.each([
    ['proxy.example:1080', 'http', 'proxy.example', 1080],
    ['[::1]:8080', 'http', '[::1]', 8080],
    ['http://proxy.example:80', 'http', 'proxy.example', 80],
    ['https://proxy.example:443/', 'https', 'proxy.example', 443],
    ['SOCKS5://127.0.0.1:1080', 'socks5', '127.0.0.1', 1080],
    ['socket5://[::1]:1080', 'socks5', '[::1]', 1080],
    ['socks5h://[::1]:1080', 'socks5', '[::1]', 1080],
    ['http://user:pass@[0:0:0:0:0:0:0:1]:80', 'http', '[::1]', 80],
    ['http://user:pass@bücher.example:80', 'http', 'xn--bcher-kva.example', 80],
  ])('parses %s with explicit ports and a fixed HTTP default', (line, type, host, port) => {
    expect(parseProxyLine(line).config).toMatchObject({ type, host, port })
  })
  it.each([
    ['proxy.example:1080:user:pass:with:colon', 'http'],
    ['socks5://proxy.example:1080:user:pass:with:colon', 'socks5'],
    ['user:pass:with:colon@proxy.example:1080', 'http'],
    ['https://user:pass:with:colon@proxy.example:1080', 'https'],
  ])('preserves credentials in %s', (line, type) => {
    expect(parseProxyLine(line)).toEqual({
      config: { type, host: 'proxy.example', port: 1080, username: 'user' },
      password: 'pass:with:colon',
    })
  })
  it('decodes URI credentials exactly once and leaves legacy credentials literal', () => {
    expect(parseProxyLine('https://user%40mail:p%40ss%3A%2525@proxy.example:443')).toEqual({
      config: { type: 'https', host: 'proxy.example', port: 443, username: 'user@mail' },
      password: 'p@ss:%25',
    })
    expect(parseProxyLine('proxy.example:80:user%40mail:p%40ss%3A%2525')).toEqual({
      config: { type: 'http', host: 'proxy.example', port: 80, username: 'user%40mail' },
      password: 'p%40ss%3A%2525',
    })
    expect(parseProxyLine('http://user%40mail:pass%40word@proxy.example:80')).toEqual({
      config: { type: 'http', host: 'proxy.example', port: 80, username: 'user@mail' },
      password: 'pass@word',
    })
    expect(parseProxyLine('socks5://user:p%2Fa%3Fs%23s%5Cword@[::1]:1080')).toEqual({
      config: { type: 'socks5', host: '[::1]', port: 1080, username: 'user' },
      password: 'p/a?s#s\\word',
    })
  })
  it.each([
    '',
    'ftp://host:80',
    'http://host',
    'host:0',
    'host:65536',
    'host:80/path',
    'http://host:80?url=evil',
    'host:80#fragment',
    'http://user:%zz@host:80',
    'http://user:pass/word@host:80',
    'http://user:pass\\word@host:80',
    'http://user:pass?word@host:80',
    'http://user:pass@word@host:80',
    'http://:pass@host:80',
    'host:80:user:',
    'http://%20user:pass@host:80',
    'http://user%20:pass@host:80',
    'http://user:pass%00word@host:80',
    'http://host name:80',
    'file:///etc/passwd',
    // Both URI and host:port:username:password are plausible; never choose silently.
    'http://user:1234:secret@proxy.example:80',
    'user:1234:secret@proxy.example:80',
    'http://user:1234:secret@word@proxy.example:80',
    'http://user:1234:secret@proxy.example:80/path',
    'http://user:1234:secret@proxy.example:80?query',
    // Literal @ in legacy credentials must be rewritten as encoded URI credentials.
    'proxy.example:80:user@mail:pass@word',
  ])('rejects an unsafe, incomplete or ambiguous line: %s', (line) => {
    expect(() => parseProxyLine(line)).toThrow()
  })
  it('allows an unambiguous URI rewrite of overlapping credential formats', () => {
    expect(parseProxyLine('http://user:1234%3Asecret@proxy.example:80')).toEqual({
      config: { type: 'http', host: 'proxy.example', port: 80, username: 'user' },
      password: '1234:secret',
    })
  })
  it('accepts only text, counts non-empty lines and bounds the entire request', () => {
    expect(importProxiesInputSchema.parse({ text: 'host:80' })).toEqual({ text: 'host:80' })
    expect(
      importProxiesInputSchema.safeParse({ text: 'host:80', defaultType: 'socks5' }).success,
    ).toBe(false)
    expect(importProxiesInputSchema.safeParse({ text: '\n  \r\n\t' }).success).toBe(false)
    expect(
      importProxiesInputSchema.safeParse({ text: '\r\nhost:80\r\n \r\n'.repeat(200) }).success,
    ).toBe(true)
    expect(importProxiesInputSchema.safeParse({ text: 'x\n'.repeat(201) }).success).toBe(false)
    expect(importProxiesInputSchema.safeParse({ text: 'x'.repeat(65537) }).success).toBe(false)
  })
  it('allows safe endpoint projections beyond source line 200 but never credentials or raw text', () => {
    const row = {
      line: 399,
      status: 'error',
      code: 'INVALID_PROXY_LINE',
      proxy: { type: 'http', host: 'host', port: 65536, hasCredentials: true },
    }
    expect(importProxiesResultSchema.safeParse([row]).success).toBe(true)
    for (const key of ['password', 'username', 'credentialRef', 'text', 'message']) {
      expect(importProxiesResultSchema.safeParse([{ ...row, [key]: 'secret' }]).success).toBe(false)
      expect(
        importProxiesResultSchema.safeParse([{ ...row, proxy: { ...row.proxy, [key]: 'secret' } }])
          .success,
      ).toBe(false)
    }
    expect(
      importProxiesResultSchema.safeParse([
        { ...row, proxy: { ...row.proxy, host: 'user:secret@host' } },
      ]).success,
    ).toBe(false)
  })
})

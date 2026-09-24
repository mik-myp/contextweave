import { describe, expect, it } from 'vitest'
import { importProxiesInputSchema, importProxiesResultSchema, parseProxyLine } from './index'
describe('proxy import format', () => {
  it.each([
    ['http://proxy.example:80', 'http', 'proxy.example', 80],
    ['https://proxy.example:443', 'https', 'proxy.example', 443],
    ['SOCKS5://127.0.0.1:1080', 'socks5', '127.0.0.1', 1080],
    ['socket5://[::1]:1080', 'socks5', '[::1]', 1080],
  ])('parses %s including explicit default ports', (line, type, host, port) => {
    expect(parseProxyLine(line).config).toMatchObject({ type, host, port })
  })
  it('supports raw and percent-encoded credentials without double decoding', () => {
    expect(parseProxyLine('proxy.example:1080:user:pass:with:colon', 'socks5')).toEqual({
      config: { type: 'socks5', host: 'proxy.example', port: 1080, username: 'user' },
      password: 'pass:with:colon',
    })
    expect(parseProxyLine('https://user%40mail:p%40ss%3A%2525@proxy.example:443')).toEqual({
      config: { type: 'https', host: 'proxy.example', port: 443, username: 'user@mail' },
      password: 'p@ss:%25',
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
    'http://host name:80',
    'file:///etc/passwd',
  ])('rejects an unsafe or incomplete line: %s', (line) => {
    expect(() => parseProxyLine(line)).toThrow()
  })
  it('bounds the batch and never accepts secrets in response data', () => {
    expect(
      importProxiesInputSchema.safeParse({ text: 'x\n'.repeat(201), defaultType: 'http' }).success,
    ).toBe(false)
    expect(
      importProxiesInputSchema.safeParse({ text: 'x'.repeat(65537), defaultType: 'http' }).success,
    ).toBe(false)
    expect(
      importProxiesResultSchema.safeParse([{ line: 1, status: 'created', password: 'secret' }])
        .success,
    ).toBe(false)
  })
})

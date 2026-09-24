import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const downloadHosts = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
])
export async function fetchControlledDownload(
  url: string,
  signal: AbortSignal,
  redirects = 0,
  allowCustomSource = false,
): Promise<Response> {
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (!allowCustomSource && (parsed.port || !downloadHosts.has(parsed.hostname))) ||
    redirects > 5
  )
    throw new Error('DOWNLOAD_SOURCE_INVALID')
  const response = await fetch(url, { signal, redirect: 'manual' })
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (!location) throw new Error('DOWNLOAD_FAILED')
    return fetchControlledDownload(
      new URL(location, url).href,
      signal,
      redirects + 1,
      allowCustomSource,
    )
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error('DOWNLOAD_FAILED')
  }
  return response
}
export async function downloadVerifiedFile(
  info: { url: string; sha256: string; sizeBytes?: number },
  path: string,
  signal: AbortSignal,
  progress: (received: number, total?: number) => void,
  download = fetchControlledDownload,
  allowCustomSource = false,
) {
  const response = await download(info.url, signal, 0, allowCustomSource)
  if (!response.body) throw new Error('DOWNLOAD_FAILED')
  const headerSize = Number(response.headers.get('content-length'))
  const maximumBytes = 800_000_000
  const total =
    info.sizeBytes ?? (Number.isSafeInteger(headerSize) && headerSize > 0 ? headerSize : undefined)
  if (total && total > maximumBytes) {
    await response.body.cancel()
    throw new Error('PACKAGE_SIZE_MISMATCH')
  }
  const digest = createHash('sha256')
  let received = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > (info.sizeBytes ?? maximumBytes)) {
        callback(new Error('PACKAGE_SIZE_MISMATCH'))
        return
      }
      digest.update(chunk)
      progress(received, total)
      callback(null, chunk)
    },
  })
  const body = response.body
  const chunks = async function* () {
    const reader = body.getReader()
    try {
      for (let item = await reader.read(); !item.done; item = await reader.read()) yield item.value
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
  }
  await pipeline(
    Readable.from(chunks()),
    meter,
    createWriteStream(path, { flags: 'wx', mode: 0o600 }),
    { signal },
  )
  if (info.sizeBytes !== undefined && received !== info.sizeBytes)
    throw new Error('PACKAGE_SIZE_MISMATCH')
  if (digest.digest('hex') !== info.sha256.toLowerCase()) throw new Error('PACKAGE_HASH_MISMATCH')
  return received
}

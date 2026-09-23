import { z } from 'zod'

/** Ask the owned browser to flush its profile before falling back to process signals. */
export async function closeBrowserGracefully(port: number): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(700),
    })
    const { webSocketDebuggerUrl } = z
      .object({ webSocketDebuggerUrl: z.string().url() })
      .parse(await response.json())
    const endpoint = new URL(webSocketDebuggerUrl)
    if (
      endpoint.protocol !== 'ws:' ||
      endpoint.hostname !== '127.0.0.1' ||
      endpoint.port !== String(port)
    )
      return
    await new Promise<void>((resolve) => {
      const socket = new WebSocket(endpoint)
      const finish = () => {
        clearTimeout(timer)
        try {
          socket.close()
        } catch {
          /* The browser may already have exited. */
        }
        resolve()
      }
      const timer = setTimeout(finish, 1000)
      socket.addEventListener(
        'open',
        () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })),
        { once: true },
      )
      socket.addEventListener('close', finish, { once: true })
      socket.addEventListener('error', finish, { once: true })
    })
  } catch {
    /* The supervisor still has a bounded process termination fallback. */
  }
}

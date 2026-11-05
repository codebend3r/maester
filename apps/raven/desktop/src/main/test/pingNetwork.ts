import { MEDIA_PROBE_BYTES } from '@raven/core'
import type { ProbeFetch } from '@/main/servers/originPicks'

const MB = 1_000_000

/**
 * How one origin answers its ping. The first chunk lands `firstByteMs` after the probe starts and
 * the rest at `bytesPerSecond`; `isBroken` errors the body after its first chunk, as the timeout
 * firing mid-read does.
 */
export type PingAnswer = {
  firstByteMs?: number
  bytesPerSecond?: number
  bytes?: number
  status?: number
  isBroken?: boolean
}

const FIRST_CHUNK_BYTES = 16_384

/**
 * Ping answers timed on one fake clock. Every wait is released in time order, one a macrotask, so
 * probes that run at once each measure only their own times. An origin with no answer rejects, as
 * a probe that fails to connect does.
 */
export const pingNetwork = (answers: Record<string, PingAnswer>) => {
  let time = 0
  let waits: { at: number; release: () => void }[] = []
  let isDriving = false
  const asked: { url: string; timeoutMs: number; at: number }[] = []

  const step = (): void => {
    const [next, ...rest] = waits.toSorted((a, b) => a.at - b.at)
    if (next === undefined) {
      isDriving = false
      return
    }
    waits = rest
    time = next.at
    next.release()
    setTimeout(step, 0)
  }

  const until = (at: number): Promise<void> =>
    new Promise((resolve) => {
      waits = [...waits, { at, release: resolve }]
      if (isDriving) return
      isDriving = true
      setTimeout(step, 0)
    })

  type BodyOfProps = { answer: PingAnswer; startedAt: number }

  const bodyOf = ({ answer, startedAt }: BodyOfProps) => {
    const bytes = answer.bytes ?? MEDIA_PROBE_BYTES
    const firstAt = startedAt + (answer.firstByteMs ?? 10)
    const lastAt = firstAt + (bytes / (answer.bytesPerSecond ?? 50 * MB)) * 1000
    const firstBytes = Math.min(FIRST_CHUNK_BYTES, bytes)
    const parts = [
      { at: firstAt, size: firstBytes },
      { at: lastAt, size: bytes - firstBytes },
    ].filter((part) => part.size > 0)
    let sent = 0
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (sent > 0 && !!answer.isBroken) throw new Error('The operation was aborted')
        const part = parts[sent]
        if (part === undefined) return controller.close()
        sent += 1
        await until(part.at)
        controller.enqueue(new Uint8Array(part.size))
      },
    })
  }

  const probe: ProbeFetch = async ({ url, timeoutMs }) => {
    asked.push({ url, timeoutMs, at: time })
    const answer = Object.entries(answers).find(([prefix]) => url.startsWith(prefix))?.[1] ?? null
    if (answer === null) throw new Error('timed out')
    const status = answer.status ?? 200
    return { ok: status >= 200 && status < 300, body: bodyOf({ answer, startedAt: time }) }
  }

  return { probe, clock: () => time, asked }
}

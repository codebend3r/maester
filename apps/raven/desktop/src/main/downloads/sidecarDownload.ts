import { isMediaTracks, type SubtitleTrack } from '@raven/core'
import { unlessStopped } from '@/main/bounded'
import type { ServerEntry } from '@/main/desktopConfig'
import type { QueueFs } from '@/main/downloads/downloadQueue'
import type { DownloadEntry, Sidecar } from '@/main/downloads/downloadState'
import { DOWNLOAD_STALL_MS, type StreamFetch } from '@/main/downloads/fetchFile'
import { sidecarUrlFor, type Access } from '@/main/downloads/mediaAccess'
import { sidecarPathFor, subtitlesDirFor } from '@/main/downloads/space'
import { parseJson } from '@/main/parseJson'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { sidecarTracksOf } from '@/main/servers/sidecarTracks'
import type { Timers } from '@/main/stateStore'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

/** The most of a subtitle kept; a larger one is skipped rather than read whole into memory. */
export const SIDECAR_MAX_BYTES = 16 * 1024 ** 2

/** A body's text, read only up to `max` bytes: past them, the rest is never read. */
const TEXT_READS = { text: 'text', tooBig: 'tooBig' } as const

const textUpTo = async ({
  body,
  max,
  signal,
}: {
  body: ReadableStream<Uint8Array> | null
  max: number
  signal: AbortSignal
}): Promise<
  { kind: typeof TEXT_READS.text; text: string } | { kind: typeof TEXT_READS.tooBig }
> => {
  const decoder = new TextDecoder()
  const read: { bytes: number; text: string; isOver: boolean } = {
    bytes: 0,
    text: '',
    isOver: false,
  }
  const sink = new WritableStream<Uint8Array>({
    write: (chunk) => {
      read.bytes += chunk.length
      if (read.bytes > max) {
        read.isOver = true
        throw new RangeError('The subtitle is larger than raven player keeps')
      }
      read.text += decoder.decode(chunk, { stream: true })
    },
  })
  try {
    await (body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() })).pipeTo(sink, {
      signal,
    })
  } catch (error) {
    if (read.isOver) return { kind: TEXT_READS.tooBig }
    throw error
  }
  return { kind: TEXT_READS.text, text: read.text + decoder.decode() }
}

/** The file whose subtitles are fetched, and the signal that stops its run. */
type SidecarJob = { entry: DownloadEntry; server: ServerEntry; signal: AbortSignal }

/**
 * A download's subtitles: the server's track list, then each sidecar fetched whole beside the
 * video. A track that fails is logged by title and track and skipped; none ever fails the file.
 */
export const createSidecarDownload = ({
  calls,
  fetchFor,
  fs,
  userData,
  timers,
  warn,
}: {
  calls: Pick<ServerCalls, 'call'>
  fetchFor: (input: { serverId: string; access: Access }) => StreamFetch
  fs: Pick<QueueFs, 'mkdir' | 'writeFile'>
  userData: string
  timers: Timers
  warn: (message: string) => void
}): ((input: { job: SidecarJob; access: Access }) => Promise<Sidecar[]>) => {
  const partsOf = (entry: DownloadEntry) => ({
    userData,
    serverId: entry.serverId,
    mediaId: entry.mediaId,
  })

  const tracksOf = async ({ entry, signal }: SidecarJob): Promise<SubtitleTrack[]> => {
    const reply = await unlessStopped({
      task: calls
        .call({
          serverId: entry.serverId,
          call: { name: CALL_NAMES.getTracks, mediaId: entry.mediaId },
        })
        .catch(() => null),
      signal,
    })
    const body =
      reply !== null && reply.ok && reply.status === HTTP_STATUSES.ok ? parseJson(reply.body) : null
    if (isMediaTracks(body)) return sidecarTracksOf(body)
    if (!signal.aborted) {
      warn(`raven player kept no subtitles for ${loggable(entry.label)}: no track list`)
    }
    return []
  }

  /** Fetches one subtitle whole and writes it; a failure is logged by title and track and skipped. */
  const fetchSidecar = async ({
    job,
    access,
    track,
  }: {
    job: SidecarJob
    access: Access
    track: SubtitleTrack
  }): Promise<Sidecar | null> => {
    const { entry, server, signal: stop } = job
    const skipped = (why = ''): null => {
      if (!stop.aborted) {
        warn(`raven player skipped subtitle ${track.id} of ${loggable(entry.label)}${why}`)
      }
      return null
    }
    const late = new AbortController()
    const timer = timers.set({ run: () => late.abort(), ms: DOWNLOAD_STALL_MS })
    const signal = AbortSignal.any([stop, late.signal])
    try {
      const response = await fetchFor({ serverId: entry.serverId, access })({
        url: sidecarUrlFor({
          access,
          origin: server.origin,
          mediaId: entry.mediaId,
          trackId: track.id,
        }),
        headers: {},
        signal,
      })
      if (response.status !== HTTP_STATUSES.ok) {
        if (response.body !== null) await response.body.cancel().catch(() => undefined)
        return skipped()
      }
      const read = await textUpTo({ body: response.body, max: SIDECAR_MAX_BYTES, signal })
      if (read.kind === TEXT_READS.tooBig) return skipped(': it is larger than 16 MiB')
      await fs.writeFile({
        path: sidecarPathFor({ ...partsOf(entry), trackId: track.id }),
        text: read.text,
      })
      return { trackId: track.id, title: track.title ?? '', language: track.language ?? '' }
    } catch {
      return skipped()
    } finally {
      timers.clear(timer)
    }
  }

  return async ({ job, access }) => {
    const tracks = await tracksOf(job)
    if (tracks.length === 0 || job.signal.aborted) return []
    const isMade = await fs.mkdir(subtitlesDirFor(partsOf(job.entry))).then(
      () => true,
      () => false,
    )
    if (!isMade) {
      warn(`raven player kept no subtitles for ${loggable(job.entry.label)}: no folder for them`)
      return []
    }
    const written = await Promise.all(tracks.map((track) => fetchSidecar({ job, access, track })))
    return written.flatMap((sidecar) => (sidecar === null ? [] : [sidecar]))
  }
}

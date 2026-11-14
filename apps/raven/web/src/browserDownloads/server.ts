import {
  type ApiClient,
  type ItemImageKind,
  MEDIA_PURPOSE_PARAM,
  type MediaAccess,
  type MediaOrigin,
  STREAM_PURPOSES,
  type SubtitleCue,
} from '@raven/core'
import type { DownloadClock } from '@/browserDownloads/clock'
import type { ExpandApi } from '@/browserDownloads/expand'
import { type DownloadWay, VARIANT_OF } from '@/browserDownloads/ways'
import { HEADERS } from '@shared/http'

/** The part of a `Response` the engine reads a file's bytes from. */
export type BytesAnswer = {
  status: number
  headers: { get: (name: string) => string | null }
  body: ReadableStream<Uint8Array> | null
}

type BytesProps = {
  mediaId: number
  way: DownloadWay
  /** The bytes already on disk, which the request's `Range` starts after. */
  from: number
  signal: AbortSignal
  /** Asks with a new ticket: the last one was refused. */
  isFresh: boolean
}

type PictureProps = { itemId: number; kind: ItemImageKind; version: string }

type CuesProps = { mediaId: number; trackId: string; window: number; signal: AbortSignal }

/** Everything the downloads ask the server, so a test hands the engine one that answers from a table. */
export type DownloadServer = {
  api: ExpandApi & Pick<ApiClient, 'getTracks' | 'getDeviceDownload'>
  bytes: (input: BytesProps) => Promise<BytesAnswer>
  /** A title's picture at its capability address; null when the server has none to give. */
  picture: (input: PictureProps) => Promise<Blob | null>
  cues: (input: CuesProps) => Promise<SubtitleCue[]>
}

/** A ticket lasts five minutes on the server; one is used again for four, as Raven's are. */
export const TICKET_REUSE_MS = 240_000

/** At most this many tickets are minted in any five minutes, so a queue never uses up the account's. */
export const MINTS_PER_WINDOW = 16
export const MINT_WINDOW_MS = 300_000

/** Names the request a download, so the server's Streams page lists it apart from what is watched. */
const asDownload = (url: string): string =>
  `${url}${url.includes('?') ? '&' : '?'}${MEDIA_PURPOSE_PARAM}=${STREAM_PURPOSES.download}`

type MediaFetch = (url: string, init?: RequestInit) => Promise<Response>

type MediaServerProps = {
  api: ApiClient
  fetch: MediaFetch
  /** The media origin the page plays from; null when media comes from the page's own address. */
  origin: () => MediaOrigin | null
  clock: DownloadClock
}

type AccessForProps = Pick<BytesProps, 'mediaId' | 'signal' | 'isFresh'>

type MintProps = Pick<BytesProps, 'mediaId' | 'signal'>

/**
 * The server as the browser reaches it. On the page's own origin the session cookie opens a
 * file, so nothing is added; through a media origin a ticket rides in the address as it does for
 * the player, minted for the fetch, kept in memory only and never written to disk or a log.
 */
export const mediaServerFor = ({ api, fetch, origin, clock }: MediaServerProps): DownloadServer => {
  const tickets = new Map<number, { ticket: string; at: number }>()
  const budget: { mints: readonly number[] } = { mints: [] }

  const mint = async ({ mediaId, signal }: MintProps): Promise<string> => {
    const now = clock.now()
    budget.mints = budget.mints.filter((at) => now - at < MINT_WINDOW_MS)
    const [oldest] = budget.mints
    if (budget.mints.length >= MINTS_PER_WINDOW && oldest !== undefined) {
      await clock.sleep({ ms: oldest + MINT_WINDOW_MS - now, signal })
      signal.throwIfAborted()
      return mint({ mediaId, signal })
    }
    budget.mints = [...budget.mints, now]
    const { ticket } = await api.getMediaTicket(mediaId)
    tickets.set(mediaId, { ticket, at: clock.now() })
    return ticket
  }

  const accessFor = async ({
    mediaId,
    signal,
    isFresh,
  }: AccessForProps): Promise<MediaAccess | null> => {
    const picked = origin()
    if (picked === null) return null
    const held = tickets.get(mediaId)
    const isLive = !isFresh && held !== undefined && clock.now() - held.at < TICKET_REUSE_MS
    return { origin: picked, ticket: isLive ? held.ticket : await mint({ mediaId, signal }) }
  }

  return {
    api,
    bytes: async ({ mediaId, way, from, signal, isFresh }) => {
      const access = await accessFor({ mediaId, signal, isFresh })
      const variant = VARIANT_OF[way]
      const url =
        variant === null
          ? api.fileUrl({ id: mediaId, access })
          : api.deviceDownloadFileUrl({ id: mediaId, access, variant })
      return fetch(asDownload(url), {
        headers: from > 0 ? { [HEADERS.range]: `bytes=${from}-` } : {},
        signal,
      })
    },
    picture: async ({ itemId, kind, version }) => {
      const url = api.itemImageUrl({ id: itemId, kind, version })
      if (url === null) return null
      const response = await fetch(url)
      return response.ok ? response.blob() : null
    },
    cues: async ({ mediaId, trackId, window, signal }) =>
      api.getSubtitles({
        id: mediaId,
        trackId,
        window,
        access: await accessFor({ mediaId, signal, isFresh: false }),
      }),
  }
}

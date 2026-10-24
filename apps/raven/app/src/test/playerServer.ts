import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type ApiClient,
  CONTAINERS,
  DEFAULT_PLAYBACK_SETTINGS,
  ENCODER_KINDS,
  HLS_COPY_AUDIO_CODECS,
  MATCH_STATES,
  type MediaTracks,
  SUBTITLE_SOURCES,
  VIDEO_CODECS,
  createApiClient,
} from '@raven/core'

import { allowlistedFetch } from '@/servers/allowlist'
import {
  type Answer,
  type HeardRequest,
  NOT_FOUND,
  STATUSES,
  pathFor,
  responseOf,
} from '@/test/fixtureFetch'
import { FILMS, NAS } from '@/test/homeServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'

/** The film library, which counts a video watched at 90%. */
const WATCHED_AT_90 = { ...FILMS, settings: { ...FILMS.settings, watchedPercent: 90 } }

/** An MP4 an iPhone plays as it is, stopped 50 minutes into its 100. */
export const BUSBOYS_MP4 = mediaItemFor({
  id: 20,
  libraryId: FILMS.id,
  title: 'Busboys',
  fileName: 'Busboys (2026).mp4',
  container: CONTAINERS.mp4,
  videoCodec: VIDEO_CODECS.h264,
  videoBitDepth: 8,
  audioCodec: HLS_COPY_AUDIO_CODECS.aac,
  audioChannels: 2,
  duration: 6000,
  position: 3000,
  match: MATCH_STATES.matched,
  item: summaryFor({ id: 40, title: 'Busboys' }),
})

/** The MP4's English text track. */
const SUBTITLE_ID = 'embedded-0'

const TRACKS: MediaTracks = {
  audio: [
    {
      index: 0,
      codec: HLS_COPY_AUDIO_CODECS.aac,
      channels: 2,
      language: 'en',
      title: null,
      default: true,
    },
  ],
  subtitles: [
    {
      id: SUBTITLE_ID,
      source: SUBTITLE_SOURCES.embedded,
      codec: 'mov_text',
      language: 'en',
      title: null,
      default: false,
      forced: false,
      hearingImpaired: false,
      supported: true,
    },
  ],
  defaultAudio: 0,
  frameRate: 24,
}

const TRACK_PARAM = ':trackId'

/** The embedded track's one cue, from ten seconds in to twenty. */
export const CUE_TEXT = 'The tide is turning.'
const VTT = ['WEBVTT', '', '00:00:10.000 --> 00:00:20.000', CUE_TEXT, ''].join('\n')

/** A route's path for the MP4. */
const busboysPath = (path: string): string => pathFor({ path, id: BUSBOYS_MP4.id })

const { getMedia, getTracks, getPlaybackSettings, getMediaOrigins, listLibraries } =
  APP_CLIENT_CALLS

const READS: Record<string, unknown> = {
  [busboysPath(getMedia.path)]: BUSBOYS_MP4,
  [busboysPath(getTracks.path)]: TRACKS,
  [getPlaybackSettings.path]: {
    settings: DEFAULT_PLAYBACK_SETTINGS,
    effective: { encoder: ENCODER_KINDS.software, tonemapAvailable: false },
  },
  [getMediaOrigins.path]: { origins: [] },
  [listLibraries.path]: [WATCHED_AT_90],
  [busboysPath(APP_CLIENT_CALLS.subtitles.path).replace(TRACK_PARAM, SUBTITLE_ID)]: VTT,
}

const WRITES: ReadonlySet<string> = new Set([
  busboysPath(APP_CLIENT_CALLS.saveProgress.path),
  busboysPath(APP_CLIENT_CALLS.recordPlay.path),
])

const bodyOf = (body: string | undefined): unknown => (body === undefined ? null : JSON.parse(body))

/** The path a request names, without its query. */
const pathOnly = (path: string): string => path.split('?')[0] ?? path

/**
 * Busboys on a server that lists no media origin, behind the app's allowlist so an unlisted call
 * fails the test. Its ticket route answers `ticketStatus`: 200 hands out a ticket, 423 says the
 * library is locked. Progress and plays are taken with no answer, and every request is heard.
 */
export const playerApi = ({
  hear,
  ticketStatus = STATUSES.ok,
}: {
  hear: (request: HeardRequest) => void
  ticketStatus?: number
}): ApiClient => {
  const answerFor = ({ method, path }: { method: string; path: string }): Answer => {
    if (method !== APP_CALL_METHODS.get) {
      return WRITES.has(path) ? { status: STATUSES.noContent, body: null } : NOT_FOUND
    }
    if (path === busboysPath(APP_CLIENT_CALLS.getMediaTicket.path)) {
      return ticketStatus === STATUSES.ok
        ? { status: ticketStatus, body: { ticket: 'tkt.player', expiresAt: 0 } }
        : { status: ticketStatus, body: { message: 'This library is locked.' } }
    }
    const read = READS[path]
    return read === undefined ? NOT_FOUND : { status: STATUSES.ok, body: read }
  }
  return createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      fetch: async (url, init = {}) => {
        const path = url.slice(NAS.origin.length)
        const method = init.method ?? APP_CALL_METHODS.get
        hear({ method, path, body: bodyOf(init.body) })
        return responseOf(answerFor({ method, path: pathOnly(path) }))
      },
    }),
  })
}

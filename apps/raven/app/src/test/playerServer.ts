import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type ApiClient,
  CONTAINERS,
  DEFAULT_PLAYBACK_SETTINGS,
  DIRECT_PLAYS,
  ENCODER_KINDS,
  HLS_COPY_AUDIO_CODECS,
  MATCH_STATES,
  type MediaTracks,
  type PlaybackSettings,
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
import { BUSBOYS } from '@/test/itemServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'
import { SUBTITLE_CODECS } from '@/test/subtitleCodecs'

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

/** The same film as an MP4 with no subtitles, which every Apple device plays as it is. */
export const BUSBOYS_UNSUBTITLED = { ...BUSBOYS_MP4, id: 21, fileName: 'Busboys (2026) Plain.mp4' }

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
      codec: SUBTITLE_CODECS.movText,
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

const UNSUBTITLED_TRACKS: MediaTracks = { ...TRACKS, subtitles: [] }

/** The film as an MP4 with no subtitles and two audio tracks. */
export const BUSBOYS_DUAL = { ...BUSBOYS_MP4, id: 22, fileName: 'Busboys (2026) Dual.mp4' }

/** The dual MP4's second audio track, a Japanese commentary. */
export const DUAL_COMMENTARY = {
  index: 1,
  codec: HLS_COPY_AUDIO_CODECS.aac,
  channels: 2,
  language: 'ja',
  title: 'Commentary',
  default: false,
} as const satisfies MediaTracks['audio'][number]

const DUAL_TRACKS: MediaTracks = {
  ...UNSUBTITLED_TRACKS,
  audio: [...UNSUBTITLED_TRACKS.audio, DUAL_COMMENTARY],
}

const TRACK_PARAM = ':trackId'

/** The embedded track's one cue, from ten seconds in to twenty. */
export const CUE_TEXT = 'The tide is turning.'
const VTT = ['WEBVTT', '', '00:00:10.000 --> 00:00:20.000', CUE_TEXT, ''].join('\n')

/** A route's path for the MP4. */
const busboysPath = (path: string): string => pathFor({ path, id: BUSBOYS_MP4.id })

/** Each file the server holds, with its tracks. */
const FILES = [
  { media: BUSBOYS_MP4, tracks: TRACKS },
  { media: BUSBOYS_UNSUBTITLED, tracks: UNSUBTITLED_TRACKS },
  { media: BUSBOYS_DUAL, tracks: DUAL_TRACKS },
] as const

const {
  getItem,
  getMedia,
  getMediaTicket,
  getTracks,
  getPlaybackSettings,
  getMediaOrigins,
  listLibraries,
  recordPlay,
  saveProgress,
  subtitles,
} = APP_CLIENT_CALLS

type FilePathsProps = { path: string }

/** A route's path for each file. */
const filePaths = ({ path }: FilePathsProps): string[] =>
  FILES.map(({ media }) => pathFor({ path, id: media.id }))

const READS: Record<string, unknown> = {
  ...Object.fromEntries(
    FILES.flatMap(({ media, tracks }) => [
      [pathFor({ path: getMedia.path, id: media.id }), media],
      [pathFor({ path: getTracks.path, id: media.id }), tracks],
    ]),
  ),
  [pathFor({ path: getItem.path, id: BUSBOYS.id })]: BUSBOYS,
  [getMediaOrigins.path]: { origins: [] },
  [listLibraries.path]: [WATCHED_AT_90],
  [busboysPath(subtitles.path).replace(TRACK_PARAM, SUBTITLE_ID)]: VTT,
}

const WRITES: ReadonlySet<string> = new Set([
  ...filePaths({ path: saveProgress.path }),
  ...filePaths({ path: recordPlay.path }),
])

const TICKETS: ReadonlySet<string> = new Set(filePaths({ path: getMediaTicket.path }))

const bodyOf = (body: string | undefined): unknown => (body === undefined ? null : JSON.parse(body))

/** The path a request names, without its query. */
const pathOnly = (path: string): string => path.split('?')[0] ?? path

type PlayerApiProps = {
  hear: (request: HeardRequest) => void
  ticketStatus?: number
  directPlay?: PlaybackSettings['directPlay']
}

/**
 * Busboys, as an MP4 with a text track, one without and one with two audio tracks, and its page,
 * on a server that lists no media origin, behind the app's allowlist so an unlisted call fails
 * the test. Its ticket route answers `ticketStatus`: 200 hands out a ticket, 423 says the library
 * is locked. Its playback settings send the original file as `directPlay` says. Progress and
 * plays are taken with no answer, and every request is heard.
 */
export const playerApi = ({
  hear,
  ticketStatus = STATUSES.ok,
  directPlay = DIRECT_PLAYS.auto,
}: PlayerApiProps): ApiClient => {
  type AnswerForProps = { method: string; path: string }

  const answerFor = ({ method, path }: AnswerForProps): Answer => {
    if (method !== APP_CALL_METHODS.get) {
      return WRITES.has(path) ? { status: STATUSES.noContent, body: null } : NOT_FOUND
    }
    if (path === getPlaybackSettings.path) {
      return {
        status: STATUSES.ok,
        body: {
          settings: { ...DEFAULT_PLAYBACK_SETTINGS, directPlay },
          effective: { encoder: ENCODER_KINDS.software, tonemapAvailable: false },
        },
      }
    }
    if (TICKETS.has(path)) {
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

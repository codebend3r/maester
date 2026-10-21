import { HLS_PARAMS, HLS_PATHS, MEDIA_TICKET_PARAM, toQueryString } from '@raven/core'
import type { HlsSession } from '@/hls/hlsSessions'

export type HlsPath = (typeof HLS_PATHS)[keyof typeof HLS_PATHS]

type HlsUriProps = {
  path: HlsPath
  values: Readonly<Record<string, string>>
  key: string | null
}

/**
 * An HLS path with its placeholders filled in, absolute, and carrying
 * `key` in `?t=` when there is one, a ticket or the session's capability:
 * a relative URI would not inherit it.
 */
const hlsUri = ({ path, values, key }: HlsUriProps): string => {
  const filled = path.replace(/:(\w+)/g, (placeholder, name: string) => {
    const value = values[name]
    return value == null ? placeholder : encodeURIComponent(value)
  })
  return key == null ? filled : `${filled}?${toQueryString({ [MEDIA_TICKET_PARAM]: key })}`
}

type SessionUrisProps = {
  session: Pick<HlsSession, 'id' | 'mediaId'>
  key: string | null
}

/** Every URI one session's playlists name. */
export const sessionUris = ({ session, key }: SessionUrisProps) => {
  type OfProps = {
    path: HlsPath
    values?: Readonly<Record<string, string>>
  }

  const of = ({ path, values = {} }: OfProps): string =>
    hlsUri({
      path,
      values: {
        [HLS_PARAMS.id]: String(session.mediaId),
        [HLS_PARAMS.session]: session.id,
        ...values,
      },
      key,
    })
  type SessionUrisSubtitleSegmentProps = { trackId: string; n: number }

  return {
    video: of({ path: HLS_PATHS.video }),
    init: of({ path: HLS_PATHS.init }),
    segment: (n: number) => of({ path: HLS_PATHS.segment, values: { [HLS_PARAMS.n]: String(n) } }),
    subtitles: (trackId: string) =>
      of({ path: HLS_PATHS.subtitles, values: { [HLS_PARAMS.trackId]: trackId } }),
    subtitleSegment: ({ trackId, n }: SessionUrisSubtitleSegmentProps) =>
      of({
        path: HLS_PATHS.subtitleSegment,
        values: { [HLS_PARAMS.trackId]: trackId, [HLS_PARAMS.n]: String(n) },
      }),
  }
}

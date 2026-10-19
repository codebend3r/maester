import { HLS_PARAMS, HLS_PATHS, MEDIA_TICKET_PARAM, toQueryString } from '@raven/core'
import type { HlsSession } from '@/hls/hlsSessions'

export type HlsPath = (typeof HLS_PATHS)[keyof typeof HLS_PATHS]

/**
 * An HLS path with its placeholders filled in, absolute, and carrying the
 * request's ticket when it had one: a relative URI would not inherit it.
 */
const hlsUri = ({
  path,
  values,
  ticket,
}: {
  path: HlsPath
  values: Readonly<Record<string, string>>
  ticket: string | null
}): string => {
  const filled = path.replace(/:(\w+)/g, (placeholder, name: string) => {
    const value = values[name]
    return value == null ? placeholder : encodeURIComponent(value)
  })
  return ticket == null ? filled : `${filled}?${toQueryString({ [MEDIA_TICKET_PARAM]: ticket })}`
}

/** Every URI one session's playlists name. */
export const sessionUris = ({
  session,
  ticket,
}: {
  session: Pick<HlsSession, 'id' | 'mediaId'>
  ticket: string | null
}) => {
  const of = (path: HlsPath, values: Readonly<Record<string, string>> = {}): string =>
    hlsUri({
      path,
      values: {
        [HLS_PARAMS.id]: String(session.mediaId),
        [HLS_PARAMS.session]: session.id,
        ...values,
      },
      ticket,
    })
  return {
    video: of(HLS_PATHS.video),
    init: of(HLS_PATHS.init),
    segment: (n: number) => of(HLS_PATHS.segment, { [HLS_PARAMS.n]: String(n) }),
    subtitles: (trackId: string) => of(HLS_PATHS.subtitles, { [HLS_PARAMS.trackId]: trackId }),
    subtitleSegment: ({ trackId, n }: { trackId: string; n: number }) =>
      of(HLS_PATHS.subtitleSegment, { [HLS_PARAMS.trackId]: trackId, [HLS_PARAMS.n]: String(n) }),
  }
}

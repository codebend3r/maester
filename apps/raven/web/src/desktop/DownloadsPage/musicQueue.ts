import {
  DOWNLOAD_KINDS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadGroup,
  type DownloadView,
  isMusicGroup,
  QUEUE_SOURCE_KINDS,
  type QueueSource,
  type Track,
} from '@raven/core'

/** The queue source each kind of music group plays as. */
const SOURCE_KINDS = {
  [DOWNLOAD_KINDS.album]: QUEUE_SOURCE_KINDS.album,
  [DOWNLOAD_KINDS.playlist]: QUEUE_SOURCE_KINDS.playlist,
} as const

type Playable = { downloadId: string; track: Track }

export type MusicQueue = { source: QueueSource; playable: readonly Playable[] }

type MusicQueueOfProps = { group: DownloadGroup; views: readonly DownloadView[] }

/**
 * What a music group plays with no server: its ready downloads that kept their track, in the
 * order `views` come in, and the album or playlist they play as. Null for a video group, and
 * for a music group with nothing to play.
 */
export const musicQueueOf = ({ group, views }: MusicQueueOfProps): MusicQueue | null => {
  if (!isMusicGroup(group)) return null
  const playable = views.flatMap(({ downloadId, status, track }) =>
    status.kind === DOWNLOAD_STATUS_KINDS.ready && track !== null ? [{ downloadId, track }] : [],
  )
  if (playable.length === 0) return null
  return { source: { kind: SOURCE_KINDS[group.kind], id: group.sourceId }, playable }
}

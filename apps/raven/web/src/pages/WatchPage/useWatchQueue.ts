import {
  type MediaItem,
  SESSION_KINDS,
  type ViewingSession,
  carriesItsOrder,
  episodesOf,
  queueStopsOf,
  seasonsOf,
  sessionOf,
  sessionOrderOf,
  watchLink,
} from '@raven/core'
import { useWatchReplace } from '@raven/ui'
import type { PlayerTitle } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { handled } from '@/lib/handled'
import { itemQuery, sagasQuery } from '@/lib/queries'
import { queueEntryOf } from '@/pages/WatchPage/queue'

type UseSessionVideosProps = { media: MediaItem; session: ViewingSession }

/*
 * The session's videos in its own order, and the season `media` is in: a season's episodes for a
 * season or a show, a saga's films for a saga. Null for a session with no order to read, and
 * until it is in.
 */
const useSessionVideos = ({ media, session }: UseSessionVideosProps) => {
  const isEpisodic = session.kind === SESSION_KINDS.season || session.kind === SESSION_KINDS.show
  const showId = media.item?.show?.id ?? null
  const show = useQuery(itemQuery(isEpisodic ? showId : null)).data ?? null
  const seasonId =
    show === null
      ? null
      : (seasonsOf(show).find(({ season }) => season === (media.item?.season ?? null))?.id ?? null)
  const season = useQuery(itemQuery(seasonId)).data ?? null
  const sagaId = session.kind === SESSION_KINDS.saga ? session.sagaId : null
  const sagas = useQuery(sagasQuery(sagaId === null ? null : media.libraryId)).data ?? null
  const films =
    sagaId === null ? null : (sagas?.find(({ tmdbId }) => tmdbId === sagaId)?.media ?? null)
  const episodes =
    season === null ? null : episodesOf(season).flatMap(({ primary }) => primary ?? [])
  return { ordered: episodes ?? films, seasonId, showId }
}

type UseWatchQueueProps = {
  media: MediaItem
  session: ViewingSession
  played: readonly MediaItem[]
  /** A queue's videos after this one. */
  upNext: readonly MediaItem[]
  /** What the server says plays next in the session. */
  found: MediaItem | null
  shuffledFrom: ViewingSession | null
}

/**
 * The player's queue for the video on screen, which its Queue menu lists and its Previous reads:
 * the session's videos in the order they play, each a link, and for an episode the shuffle that
 * deals the rest of its season or show as a queue, or puts the session it was dealt from back.
 */
export const useWatchQueue = ({
  media,
  session,
  played,
  upNext,
  found,
  shuffledFrom,
}: UseWatchQueueProps): Pick<PlayerTitle, 'queue'> => {
  // The same video under another session: the player stays, and only what surrounds it changes.
  const replay = useWatchReplace()
  const { ordered, seasonId, showId } = useSessionVideos({ media, session })
  const order = sessionOrderOf({ media, session, played, upNext, ordered, found })
  const stops = queueStopsOf({ media, session, order, shuffledFrom })
  const isShuffled = carriesItsOrder(session)

  const deal = async (itemId: number) => {
    const dealt = await api.shuffleEpisodes(itemId)
    replay(
      watchLink({
        media,
        session: { kind: SESSION_KINDS.queue },
        upNext: dealt.filter((each) => each.id !== media.id),
        shuffledFrom: session,
      }),
    )
  }

  const setShuffle = (isOn: boolean) => {
    if (isOn === isShuffled) return
    if (!isOn) {
      replay(watchLink({ media, session: shuffledFrom ?? sessionOf(media) }))
      return
    }
    const itemId = session.kind === SESSION_KINDS.season ? (seasonId ?? showId) : showId
    if (itemId !== null) handled(deal(itemId))
  }

  // A video on its own, neither an episode nor one of several, has no queue to show.
  if (stops.length < 2 && showId === null) return { queue: null }
  const shuffle = showId === null ? null : { isOn: isShuffled, set: setShuffle }
  return { queue: { entries: stops.map((stop, at) => queueEntryOf({ stop, at })), shuffle } }
}

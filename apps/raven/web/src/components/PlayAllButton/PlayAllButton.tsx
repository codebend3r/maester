import { SHOW_SESSION, episodesOf, firstEpisodeIn, watchLink } from '@raven/core'
import { Button } from '@raven/ui'
import { PLAY_ALL_COPY } from '@/components/PlayAllButton/copy'
import { api } from '@/lib/api'
import { START_STATES, type StartState, useStartPlay } from '@/lib/useStartPlay'

const LABELS = {
  [START_STATES.idle]: PLAY_ALL_COPY.playAll,
  [START_STATES.loading]: PLAY_ALL_COPY.starting,
  [START_STATES.empty]: PLAY_ALL_COPY.nothingToPlay,
} as const satisfies Record<StartState, string>

type PlayAllButtonProps = { seasonId: number }

/**
 * Plays the first episode of the season `seasonId`, then every
 * episode after it in order, on into the next seasons: the show session, so
 * the end of a season does not stop it. The season loads only when pressed.
 */
export const PlayAllButton = ({ seasonId }: PlayAllButtonProps) => {
  const { state, start } = useStartPlay({
    load: async () => {
      const media = firstEpisodeIn(episodesOf(await api.getItem(seasonId)))?.primary ?? null
      return media === null ? null : watchLink({ media, session: SHOW_SESSION })
    },
  })
  return (
    <Button
      icon="play"
      onClick={start}
      disabled={state !== START_STATES.idle}
      aria-busy={state === START_STATES.loading}
    >
      {LABELS[state]}
    </Button>
  )
}

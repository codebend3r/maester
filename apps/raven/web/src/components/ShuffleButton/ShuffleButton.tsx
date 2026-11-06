import { type MediaItem, queueLink, shuffleSessionOf, watchLink } from '@raven/core'
import { Button } from '@raven/ui'
import { SHUFFLE_BUTTON_COPY } from '@/components/ShuffleButton/copy'
import { api } from '@/lib/api'
import { START_STATES, type StartState, useStartPlay } from '@/lib/useStartPlay'

const LABELS = {
  [START_STATES.idle]: null,
  [START_STATES.loading]: SHUFFLE_BUTTON_COPY.picking,
  [START_STATES.empty]: SHUFFLE_BUTTON_COPY.nothingToPlay,
} as const satisfies Record<StartState, string | null>

type ShuffleButtonProps = {
  itemId: number
  /**
   * Whether `itemId` is a show to shuffle without end: the first episode the
   * server deals plays, and each next is another drawn by the server from any
   * season. Otherwise the dealt queue plays through and stops, as a season's does.
   */
  isWholeShow?: boolean
  children: string
}

type LinkOfProps = { queue: readonly MediaItem[]; itemId: number; isWholeShow: boolean }

const linkOf = ({ queue, itemId, isWholeShow }: LinkOfProps) => {
  if (!isWholeShow) return queueLink({ queue })
  const [first] = queue
  return first ? watchLink({ media: first, session: shuffleSessionOf(itemId) }) : null
}

/**
 * Plays the episodes under `itemId`, a show or a season, in a random order,
 * among the files this browser may see: the first at once, the rest one
 * after another. The server deals them, so a show's page offers it without
 * loading a single episode. `children` is the label, "Shuffle" or "Shuffle
 * season".
 */
export const ShuffleButton = ({ itemId, isWholeShow = false, children }: ShuffleButtonProps) => {
  const { state, start } = useStartPlay({
    load: async () => linkOf({ queue: await api.shuffleEpisodes(itemId), itemId, isWholeShow }),
  })
  return (
    <Button
      icon="shuffle"
      onClick={start}
      disabled={state !== START_STATES.idle}
      aria-busy={state === START_STATES.loading}
    >
      {LABELS[state] ?? children}
    </Button>
  )
}

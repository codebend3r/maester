import { queueLink } from '@raven/core'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@raven/ui'
import { SHUFFLE_BUTTON_COPY } from '@/components/ShuffleButton/copy'
import { api } from '@/lib/api'

const PICK_STATES = { idle: 'idle', picking: 'picking', empty: 'empty' } as const

type PickState = (typeof PICK_STATES)[keyof typeof PICK_STATES]

const LABELS = {
  [PICK_STATES.idle]: null,
  [PICK_STATES.picking]: SHUFFLE_BUTTON_COPY.picking,
  [PICK_STATES.empty]: SHUFFLE_BUTTON_COPY.nothingToPlay,
} as const satisfies Record<PickState, string | null>

type ShuffleButtonProps = { itemId: number; children: string }

/**
 * Plays the episodes under `itemId`, a show or a season, in a random order,
 * among the files this browser may see: the first at once, the rest one
 * after another. The server deals them, so a show's page offers it without
 * loading a single episode. `children` is the label, "Shuffle" or "Shuffle
 * season".
 */
export const ShuffleButton = ({ itemId, children }: ShuffleButtonProps) => {
  const navigate = useNavigate()
  const [state, setState] = useState<PickState>(PICK_STATES.idle)
  const pick = () => {
    setState(PICK_STATES.picking)
    api
      .shuffleEpisodes(itemId)
      .then((queue) => {
        const link = queueLink({ queue })
        if (!link) {
          setState(PICK_STATES.empty)
          return
        }
        navigate(link.to, { state: link.state })
      })
      .catch(() => setState(PICK_STATES.idle))
  }
  return (
    <Button
      icon="shuffle"
      onClick={pick}
      disabled={state !== PICK_STATES.idle}
      aria-busy={state === PICK_STATES.picking}
    >
      {LABELS[state] ?? children}
    </Button>
  )
}

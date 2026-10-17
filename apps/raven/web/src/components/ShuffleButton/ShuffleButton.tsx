import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@raven/ui'
import { api } from '@/lib/api'
import { watchLink } from '@/lib/itemLinks'

const PICK_STATES = { idle: 'idle', picking: 'picking', empty: 'empty' } as const

type PickState = (typeof PICK_STATES)[keyof typeof PICK_STATES]

const LABELS = {
  idle: null,
  picking: 'Picking',
  empty: 'Nothing to play',
} as const satisfies Record<PickState, string | null>

/**
 * Plays an episode picked at random from under `itemId`, a show or a season,
 * among the files this browser may see. The server picks, so a show's page
 * offers it without loading a single episode. `children` is the label,
 * "Shuffle" or "Shuffle season".
 */
export const ShuffleButton = ({ itemId, children }: { itemId: number; children: string }) => {
  const navigate = useNavigate()
  const [state, setState] = useState<PickState>(PICK_STATES.idle)
  const pick = () => {
    setState(PICK_STATES.picking)
    api
      .randomEpisode(itemId)
      .then((media) => {
        if (!media) {
          setState(PICK_STATES.empty)
          return
        }
        const link = watchLink({ media })
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

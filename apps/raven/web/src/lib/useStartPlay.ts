import type { watchLink } from '@raven/core'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

/** Where a button that loads what it plays stands: waiting, loading it, or finding nothing. */
export const START_STATES = { idle: 'idle', loading: 'loading', empty: 'empty' } as const

export type StartState = (typeof START_STATES)[keyof typeof START_STATES]

type PlayLink = ReturnType<typeof watchLink>

type UseStartPlayProps = {
  /** What plays, read only when pressed; null when there is nothing to play. */
  load: () => Promise<PlayLink | null>
}

type StartPlay = { state: StartState; start: () => void }

/**
 * A press that reads what to play, then goes to the player with it: empty when the read finds
 * nothing, and back to idle when it fails, so the press can be tried again.
 */
export const useStartPlay = ({ load }: UseStartPlayProps): StartPlay => {
  const navigate = useNavigate()
  const [state, setState] = useState<StartState>(START_STATES.idle)
  const start = () => {
    setState(START_STATES.loading)
    load()
      .then((link) => {
        if (link === null) {
          setState(START_STATES.empty)
          return
        }
        navigate(link.to, { state: link.state })
      })
      .catch(() => setState(START_STATES.idle))
  }
  return { state, start }
}

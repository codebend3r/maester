import { SESSION_KINDS, readWatchState } from '@raven/core'
import { useLocation, useParams } from 'react-router-dom'

/** Stands in for the player at `watch/:id`: the video a link opened, the saga it plays in, and the ones it handed over to play after. */
export const WatchProbe = () => {
  const id = Number(useParams().id)
  const handed = readWatchState({ state: useLocation().state, id })
  const after = (handed?.upNext ?? []).map((media) => media.id).join(', ')
  const session = handed?.session ?? null
  const saga = session?.kind === SESSION_KINDS.saga ? ` in saga ${session.sagaId}` : ''
  return <p>{`Playing ${id}${saga}, then ${after}`}</p>
}

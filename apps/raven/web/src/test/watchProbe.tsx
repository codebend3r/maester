import { useLocation, useParams } from 'react-router-dom'
import { readWatchState } from '@/lib/itemLinks'

/** Stands in for the player at `watch/:id`: the video a link opened, and the ones it handed over to play after. */
export const WatchProbe = () => {
  const id = Number(useParams().id)
  const handed = readWatchState({ state: useLocation().state, id })
  const after = (handed?.upNext ?? []).map((media) => media.id).join(', ')
  return <p>{`Playing ${id}, then ${after}`}</p>
}

import { useNavigate } from 'react-router-dom'
import type { UpNext } from '@/components/Player/PlayerServices'

/** Where a move lands: a video's address and what its link hands over. */
export type WatchStop = Pick<UpNext, 'to' | 'state'>

/**
 * Plays another video in the current one's place: it replaces the watch entry, so Back still
 * leaves the player however many videos it moved through. Next, Previous, a pick from the Queue
 * menu and a change of what surrounds the video all move this way.
 */
export const useWatchReplace = () => {
  const navigate = useNavigate()
  return ({ to, state }: WatchStop): void => {
    Promise.resolve(navigate(to, { replace: true, state })).catch(() => undefined)
  }
}

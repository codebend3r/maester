import { useWatchReplace } from '@/components/Player/useWatchReplace'
import { useHostServices } from '@/stores/playerServices'

/**
 * The session's queue and the moves through it that are not Next's: the video before this one,
 * which is the queue's entry ahead of the one playing, and any video picked from the Queue menu.
 */
export const useQueueMoves = () => {
  const play = useWatchReplace()
  const queue = useHostServices((services) => services.title.queue)
  const entries = queue?.entries ?? []
  const at = entries.findIndex(({ isCurrent }) => isCurrent)
  const previous = entries[at - 1] ?? null
  return {
    previous,
    queue,
    play,
    playPrevious: () => {
      if (previous !== null) play(previous)
    },
  }
}

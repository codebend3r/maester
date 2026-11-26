import type { Track } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY } from '@raven/wren'
import { toastFailure, useToast } from '@raven/wren-native'

import { FocusButton } from '@/ui/FocusButton'
import { ICONS } from '@/ui/WrenIcon'

type QueueButtonProps = {
  tracksOf: () => Promise<readonly Track[]>
  /** What the toast says once the tracks are queued. */
  queued: string
}

/** An album's or a playlist's Queue: its tracks after what plays, said in a toast. */
export function QueueButton({ tracksOf, queued }: QueueButtonProps) {
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const toast = useToast((state) => state.show)
  const queue = () => {
    tracksOf().then((tracks) => {
      addToQueue(tracks)
      toast(queued)
    }, toastFailure)
  }
  return <FocusButton icon={ICONS.queueAdd} label={PLAYER_COPY.queue} onPress={queue} />
}

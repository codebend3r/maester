import { PLAYER_COPY, WREN_ICONS } from '@raven/wren'
import { DetailAction } from '@/components/DetailAction/DetailAction'

type QueueActionProps = { onPress: () => void }

/** Queue, among an album's or a playlist's actions: adds its tracks after what is queued. */
export function QueueAction({ onPress }: QueueActionProps) {
  return <DetailAction icon={WREN_ICONS.queueAdd} label={PLAYER_COPY.queue} onPress={onPress} />
}

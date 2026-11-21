import { PLAYER_COPY } from '@raven/wren'
import { DetailAction } from '@/components/DetailAction/DetailAction'
import { ICONS } from '@/ui/WrenIcon/icons'

type QueueActionProps = { onPress: () => void }

/** Queue, among an album's or a playlist's actions: adds its tracks after what is queued. */
export function QueueAction({ onPress }: QueueActionProps) {
  return <DetailAction icon={ICONS.queueAdd} label={PLAYER_COPY.queue} onPress={onPress} />
}

import { PLAYER_COPY, WREN_ICONS } from '@raven/wren'

import { DetailAction } from '@/components/DetailAction'
import { useWrenTheme } from '@/theme/wrenTheme'
import { WrenIcon } from '@/ui/WrenIcon'

type QueueActionProps = { onPress: () => void }

/** Queue, among an album's or a playlist's actions: adds its tracks after what is queued. */
export function QueueAction({ onPress }: QueueActionProps) {
  const { colors } = useWrenTheme()
  return (
    <DetailAction
      glyph={<WrenIcon color={colors.text2} name={WREN_ICONS.queueAdd} />}
      label={PLAYER_COPY.queue}
      onPress={onPress}
    />
  )
}

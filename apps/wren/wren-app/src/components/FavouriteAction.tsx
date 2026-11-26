import { WREN_ICONS } from '@raven/wren'
import type { ComponentProps } from 'react'

import { DetailAction } from '@/components/DetailAction'
import { useWrenTheme } from '@/theme/wrenTheme'
import { WrenIcon } from '@/ui/WrenIcon'

type FavouriteActionProps = Pick<ComponentProps<typeof DetailAction>, 'label' | 'shape'> & {
  isOn: boolean
  onToggle: () => void
}

/** An album's Like or an artist's Follow: a heart, red and filled while it is a favourite. */
export function FavouriteAction({ label, shape, isOn, onToggle }: FavouriteActionProps) {
  const { colors } = useWrenTheme()
  return (
    <DetailAction
      glyph={
        <WrenIcon
          color={isOn ? colors.accentText : colors.text2}
          name={isOn ? WREN_ICONS.heartFilled : WREN_ICONS.heart}
        />
      }
      isOn={isOn}
      label={label}
      onPress={onToggle}
      shape={shape}
    />
  )
}

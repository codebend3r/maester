import type { ComponentProps } from 'react'
import { DetailAction } from '@/components/DetailAction/DetailAction'
import { ICONS } from '@/ui/WrenIcon/icons'

type FavouriteActionProps = Pick<ComponentProps<typeof DetailAction>, 'label' | 'shape'> & {
  isOn: boolean
  onToggle: () => void
}

/** An album's Like or an artist's Follow: a heart, red and filled while it is a favourite. */
export function FavouriteAction({ label, shape, isOn, onToggle }: FavouriteActionProps) {
  return (
    <DetailAction
      icon={isOn ? ICONS.heartFilled : ICONS.heart}
      isOn={isOn}
      label={label}
      onPress={onToggle}
      shape={shape}
    />
  )
}

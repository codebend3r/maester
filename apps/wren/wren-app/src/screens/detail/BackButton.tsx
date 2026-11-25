import { useRouter } from 'expo-router'

import { KIT_COPY } from '@raven/wren'
import { useWrenTheme } from '@/theme/wrenTheme'
import { IconButton } from '@/ui/IconButton'
import { ICONS } from '@/ui/WrenIcon'

type BackButtonProps = {
  /** The icon's colour and the circle's fill over a picture: the artist's hero. */
  onPicture?: { ink: string; veil: string }
}

/** The way back from a page a listing opened, as the phone's nav bar draws it. */
export function BackButton({ onPicture }: BackButtonProps) {
  const router = useRouter()
  const { colors } = useWrenTheme()
  return (
    <IconButton
      color={onPicture?.ink ?? colors.text}
      fill={onPicture?.veil}
      icon={ICONS.back}
      label={KIT_COPY.backAlone}
      onPress={() => router.back()}
    />
  )
}

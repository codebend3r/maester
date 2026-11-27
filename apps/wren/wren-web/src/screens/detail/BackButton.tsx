import { KIT_COPY, WREN_ICONS } from '@raven/wren'
import { WREN_ROUTES } from '@/routes'
import { useGoBack } from '@/shell/useGoBack'
import { COLORS, type Color } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'

/** The icon's colour and the circle's fill over a picture. */
type OnPicture = { ink: Color; veil: Color }

type BackButtonProps = {
  /** The icon's colour and the circle's fill over a picture: the artist's hero. */
  onPicture?: OnPicture | null
}

/**
 * The way back from a page a listing opened, as the phone's nav bar draws it: to the page
 * behind this one, or to Library when the page was opened by its address.
 */
export function BackButton({ onPicture = null }: BackButtonProps) {
  const goBack = useGoBack({ fallback: WREN_ROUTES.library })
  const picture = onPicture === null ? {} : { color: onPicture.ink, fill: onPicture.veil }
  return (
    <IconButton
      color={COLORS.text}
      {...picture}
      icon={WREN_ICONS.back}
      label={KIT_COPY.backAlone}
      onPress={goBack}
    />
  )
}

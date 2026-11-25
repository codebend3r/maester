import { PLAYER_COPY } from '@raven/wren'
import { BUTTON_VARIANTS, Button } from '@/ui/Button/Button'
import { ICONS } from '@/ui/WrenIcon/icons'

type PlayButtonsProps = {
  onPlay: () => void
  onShuffle: () => void
  /** Whether the two share the width they are given equally; an artist's keep their own on the wide layout. */
  isStretched?: boolean
}

/** Play and Shuffle side by side, for an album, a playlist, an artist or the songs. */
export function PlayButtons({ onPlay, onShuffle, isStretched = true }: PlayButtonsProps) {
  return (
    <>
      <Button
        icon={ICONS.play}
        isStretched={isStretched}
        label={PLAYER_COPY.play}
        onPress={onPlay}
      />
      <Button
        icon={ICONS.shuffle}
        isStretched={isStretched}
        label={PLAYER_COPY.shuffle}
        onPress={onShuffle}
        variant={BUTTON_VARIANTS.secondary}
      />
    </>
  )
}

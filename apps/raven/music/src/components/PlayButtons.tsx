import { PLAYER_COPY } from '@raven/wren'
import { BUTTON_VARIANTS, Button } from '@/ui/Button'
import { ICONS } from '@/ui/WrenIcon'

type PlayButtonsProps = { onPlay: () => void; onShuffle: () => void }

/** Play and Shuffle side by side at equal width, for an album or a playlist. */
export function PlayButtons({ onPlay, onShuffle }: PlayButtonsProps) {
  return (
    <>
      <Button icon={ICONS.play} isStretched label={PLAYER_COPY.play} onPress={onPlay} />
      <Button
        icon={ICONS.shuffle}
        isStretched
        label={PLAYER_COPY.shuffle}
        onPress={onShuffle}
        variant={BUTTON_VARIANTS.secondary}
      />
    </>
  )
}

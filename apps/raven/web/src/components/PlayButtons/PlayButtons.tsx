import { Button } from '@raven/ui'
import { COMMON_COPY } from '@/lib/copy'

type PlayButtonsProps = {
  playable: boolean
  onPlay: () => void
  onShuffle: () => void
}

/** Play and Shuffle, always there, waiting until there is something to play. Their container lays them out. */
export const PlayButtons = ({ playable, onPlay, onShuffle }: PlayButtonsProps) => (
  <>
    <Button tone="primary" icon="play" disabled={!playable} onClick={onPlay}>
      {COMMON_COPY.play}
    </Button>
    <Button icon="shuffle" disabled={!playable} onClick={onShuffle}>
      {COMMON_COPY.shuffle}
    </Button>
  </>
)

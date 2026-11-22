import { AUDIOBOOK_SPEEDS, usePlayerPrefs } from '@raven/ui/headless'
import { NOW_PLAYING_COPY, PLAYER_COPY } from '@raven/wren'
import { Volume } from '@/player/Volume/Volume'
import { SegmentedControl } from '@/ui/SegmentedControl/SegmentedControl'
import styles from '@/screens/NowPlaying/PlayerExtras.module.scss'

/** The speeds a book plays at, each keyed by its number: "1.25×". */
const SPEED_CHOICES = AUDIOBOOK_SPEEDS.map((speed) => ({
  key: speed,
  label: NOW_PLAYING_COPY.speedOf(speed),
}))

/** The book's speed, which only an audiobook offers. */
function SpeedControl() {
  const speed = usePlayerPrefs((prefs) => prefs.audiobookSpeed)
  const setSpeed = usePlayerPrefs((prefs) => prefs.setAudiobookSpeed)
  return (
    <SegmentedControl
      choices={SPEED_CHOICES}
      label={PLAYER_COPY.speed}
      onSelect={setSpeed}
      selected={speed}
    />
  )
}

type PlayerExtrasProps = { isAudiobook: boolean }

/** Under the transport: Wren's own volume, a thin line, and an audiobook's speed. */
export function PlayerExtras({ isAudiobook }: PlayerExtrasProps) {
  return (
    <div className={styles.extras}>
      <Volume />
      {isAudiobook && <SpeedControl />}
    </div>
  )
}

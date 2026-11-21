import { AUDIOBOOK_SPEEDS, usePlayerPrefs } from '@raven/ui/headless'
import { View } from 'react-native'

import { NOW_PLAYING_COPY, PLAYER_COPY } from '@raven/wren'
import { Adjuster } from '@/player/Adjuster'
import { themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { SegmentedControl } from '@/ui/SegmentedControl'

// How far a screen reader's swipe moves the volume.
const VOLUME_STEP = 0.1

/** The speeds a book plays at, each keyed by its number: "1.25×". */
const SPEED_CHOICES = AUDIOBOOK_SPEEDS.map((speed) => ({
  key: speed,
  label: NOW_PLAYING_COPY.speedOf(speed),
}))

const useStyles = themedStyles(() => ({ extras: { gap: SPACE.s3 } }))

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

/**
 * Under the transport: Wren's own volume, a thin line beside the device's buttons, and an
 * audiobook's speed.
 */
export function PlayerExtras({ isAudiobook }: PlayerExtrasProps) {
  const styles = useStyles()
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  return (
    <View style={styles.extras}>
      <Adjuster
        label={PLAYER_COPY.volume}
        max={1}
        onChange={(level) => setVolume({ volume: level, muted: false })}
        step={VOLUME_STEP}
        value={volume}
        valueText={NOW_PLAYING_COPY.percent}
      />
      {isAudiobook && <SpeedControl />}
    </View>
  )
}

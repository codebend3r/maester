import { usePlayerPrefs } from '@raven/ui/headless'
import { NOW_PLAYING_COPY, PLAYER_COPY } from '@raven/wren'
import { Adjuster } from '@/player/Adjuster/Adjuster'

// How far an arrow key moves the volume, of its whole from 0 to 1.
const VOLUME_STEP = 0.05

const FULL_VOLUME = 1

/** Wren's own volume, from silent to full, kept with the player's other choices in this browser. */
export function Volume() {
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  return (
    <Adjuster
      label={PLAYER_COPY.volume}
      max={FULL_VOLUME}
      onChange={(next) => setVolume({ volume: next, muted: false })}
      step={VOLUME_STEP}
      value={volume}
      valueText={NOW_PLAYING_COPY.percent}
    />
  )
}

import { usePlayerPrefs } from '@raven/ui/headless'
import { NOW_PLAYING_COPY, PLAYER_COPY, WREN_ICONS } from '@raven/wren'
import { Adjuster } from '@/player/Adjuster/Adjuster'
import { IconButton } from '@/ui/IconButton/IconButton'
import styles from '@/player/Volume/Volume.module.scss'

// How far an arrow key moves the volume, of its whole from 0 to 1.
const VOLUME_STEP = 0.05

const FULL_VOLUME = 1

const SILENT = 0

/**
 * Wren's own volume, kept with the player's other choices in this browser: a speaker that mutes
 * and unmutes, so the line beside it is never taken for the scrubber, and the line, from silent
 * to full. While muted the line stands at silent, and moving it unmutes.
 */
export function Volume() {
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  const shown = isMuted ? SILENT : volume
  return (
    <div className={styles.volume}>
      <IconButton
        icon={shown === SILENT ? WREN_ICONS.volumeMuted : WREN_ICONS.volume}
        label={isMuted ? PLAYER_COPY.unmute : PLAYER_COPY.mute}
        onPress={() => setVolume({ volume, muted: !isMuted })}
      />
      <Adjuster
        label={PLAYER_COPY.volume}
        max={FULL_VOLUME}
        onChange={(next) => setVolume({ volume: next, muted: false })}
        step={VOLUME_STEP}
        value={shown}
        valueText={NOW_PLAYING_COPY.percent}
      />
    </div>
  )
}

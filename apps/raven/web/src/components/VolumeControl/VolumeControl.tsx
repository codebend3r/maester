import { BUTTON_TONES, Button, classNames, volumeIconOf } from '@raven/ui'
import { usePlayerPrefs } from '@raven/ui/headless'
import { VOLUME_COPY } from '@/components/VolumeControl/copy'
import styles from '@/components/VolumeControl/VolumeControl.module.scss'

/** The slider's whole numbers: silent to full. */
const VOLUME_STEPS = 100

type VolumeControlProps = { className?: string }

/**
 * How loud music plays: a speaker that mutes and unmutes, beside a slider. It reads and writes
 * the volume every player shares, so the audio hosts follow it as they do the video player's.
 */
export const VolumeControl = ({ className }: VolumeControlProps) => {
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  const shown = isMuted ? 0 : Math.round(volume * VOLUME_STEPS)
  return (
    <div className={classNames([styles.volume, className])}>
      <Button
        tone={BUTTON_TONES.ghost}
        icon={volumeIconOf({ volume, isMuted })}
        aria-label={isMuted ? VOLUME_COPY.unmute : VOLUME_COPY.mute}
        onClick={() => setVolume({ volume, muted: !isMuted })}
      />
      <input
        type="range"
        className={styles.range}
        aria-label={VOLUME_COPY.volume}
        min={0}
        max={VOLUME_STEPS}
        step={1}
        value={shown}
        onChange={(event) =>
          setVolume({ volume: Number(event.target.value) / VOLUME_STEPS, muted: false })
        }
      />
    </div>
  )
}

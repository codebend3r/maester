import { useId } from 'react'
import { CONTROLS_LINGER_SECONDS, usePlayerPrefs } from '@raven/ui/headless'
import { Titled } from '@/pages/SettingsPage/Titled'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

/**
 * Settings few need, which this browser keeps for itself, so neither the
 * admin lock nor Reset to defaults has a say in them. For now, how long the
 * player's controls linger.
 */
export const AdvancedSection = () => {
  const ids = { heading: useId(), linger: useId() }
  const lingerSeconds = usePlayerPrefs((prefs) => prefs.controlsLingerSeconds)
  const setLingerSeconds = usePlayerPrefs((prefs) => prefs.setControlsLingerSeconds)
  const lingerWords = `${lingerSeconds} seconds`
  return (
    <section className={styles.section} aria-labelledby={ids.heading}>
      <header className={styles.sectionHead}>
        <h2 id={ids.heading} className={styles.heading}>
          <Titled icon="settings">Advanced</Titled>
        </h2>
        <p className={styles.help}>For this browser only.</p>
      </header>
      <div className={styles.setting}>
        <label htmlFor={ids.linger} className={styles.legend}>
          <Titled icon="playback">Hide the player's controls after</Titled>
        </label>
        <div className={styles.slider}>
          <input
            id={ids.linger}
            type="range"
            className={styles.range}
            min={CONTROLS_LINGER_SECONDS.min}
            max={CONTROLS_LINGER_SECONDS.max}
            step={1}
            value={lingerSeconds}
            aria-valuetext={lingerWords}
            onChange={(event) => setLingerSeconds(Number(event.target.value))}
          />
          {/* The slider's own value text says it to a screen reader. */}
          <span className={styles.sliderValue} aria-hidden="true">
            {lingerWords}
          </span>
        </div>
        <p className={styles.hint}>
          How long the controls and the cursor stay over the video once the mouse, the keys and
          clicks go quiet, from {CONTROLS_LINGER_SECONDS.min} to {CONTROLS_LINGER_SECONDS.max}{' '}
          seconds.
        </p>
      </div>
    </section>
  )
}

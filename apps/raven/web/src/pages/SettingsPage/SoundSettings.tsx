import { CROSSFADE_SECONDS, EQ_BANDS, EQ_GAIN_DB, EQ_PRESETS, LEVELLING_MODES } from '@raven/core'
import { MUSIC_QUALITIES, usePlayerPrefs } from '@raven/ui/headless'
import { type ComponentType, useId } from 'react'
import { type AudioConnection, useAudioConnection } from '@/desktop/audioConnection'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'
import { Setting } from '@/pages/SettingsPage/Setting'
import { Titled } from '@/pages/SettingsPage/Titled'
import { EQ_CHOICE_NAMES, SETTINGS_COPY, SOUND_CHOICES_COPY } from '@/pages/SettingsPage/copy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import soundStyles from '@/pages/SettingsPage/SoundSettings.module.scss'

const COPY = SETTINGS_COPY.sound

/** Crossfade as a slider over its steps, off at the left. */
const CrossfadeSlider = () => {
  const id = useId()
  const crossfade = usePlayerPrefs((prefs) => prefs.crossfade)
  const setCrossfade = usePlayerPrefs((prefs) => prefs.setCrossfade)
  const words = COPY.crossfadeFor(crossfade)
  return (
    <div className={styles.setting}>
      <label htmlFor={id} className={styles.legend}>
        <Titled icon="merge">{COPY.crossfade}</Titled>
      </label>
      <div className={styles.slider}>
        <input
          id={id}
          type="range"
          className={styles.range}
          min={0}
          max={CROSSFADE_SECONDS.length - 1}
          step={1}
          value={CROSSFADE_SECONDS.indexOf(crossfade)}
          aria-valuetext={words}
          onChange={(event) => {
            const seconds = CROSSFADE_SECONDS[Number(event.target.value)]
            if (seconds !== undefined) setCrossfade(seconds)
          }}
        />
        {/* The slider's own value text says it to a screen reader. */}
        <span className={styles.sliderValue} aria-hidden="true">
          {words}
        </span>
      </div>
      <p className={styles.hint}>{COPY.crossfadeHint}</p>
    </div>
  )
}

/** Where Raven's mpv engine plays the music: it plays one file at a time, so it has no crossfade. */
const CrossfadeLater = () => (
  <div className={styles.setting}>
    <p className={styles.legend}>
      <Titled icon="merge">{COPY.crossfade}</Titled>
    </p>
    <p className={styles.hint}>{COPY.crossfadeLater}</p>
  </div>
)

const RAVEN_CROSSFADES = {
  [CONNECTION_STATUSES.waiting]: CrossfadeSlider,
  [CONNECTION_STATUSES.native]: CrossfadeLater,
  [CONNECTION_STATUSES.unavailable]: CrossfadeSlider,
  [CONNECTION_STATUSES.lost]: CrossfadeSlider,
} as const satisfies Record<AudioConnection['status'], ComponentType>

/** Inside Raven, crossfade as its music engine allows: none through mpv, the slider through Chromium. */
const RavenCrossfade = () => {
  const { status } = useAudioConnection()
  const View = RAVEN_CROSSFADES[status]
  return <View />
}

const SOUND_HOSTS = { browser: 'browser', raven: 'raven' } as const

type SoundHost = (typeof SOUND_HOSTS)[keyof typeof SOUND_HOSTS]

const CROSSFADES = {
  [SOUND_HOSTS.browser]: CrossfadeSlider,
  [SOUND_HOSTS.raven]: RavenCrossfade,
} as const satisfies Record<SoundHost, ComponentType>

/** The equalizer: a preset, or each of its ten bands set by hand, which makes it custom. */
const Equalizer = () => {
  const bandId = useId()
  const equalizer = usePlayerPrefs((prefs) => prefs.equalizer)
  const setEqualizer = usePlayerPrefs((prefs) => prefs.setEqualizer)
  return (
    <Setting
      icon="split"
      label={COPY.equalizer}
      values={Object.values(EQ_CHOICE_NAMES)}
      choices={SOUND_CHOICES_COPY.presets}
      value={equalizer.preset ?? EQ_CHOICE_NAMES.custom}
      onChange={(choice) =>
        setEqualizer(
          choice === EQ_CHOICE_NAMES.custom
            ? { preset: null, gains: equalizer.gains }
            : { preset: choice, gains: EQ_PRESETS[choice] },
        )
      }
    >
      <ul className={soundStyles.bands} aria-label={COPY.bands}>
        {EQ_BANDS.map((hz, index) => {
          const gain = equalizer.gains[index] ?? 0
          const id = `${bandId}-${hz}`
          return (
            <li key={hz} className={soundStyles.band}>
              {/* The slider's own value text says it to a screen reader. */}
              <span className={soundStyles.gain} aria-hidden="true">
                {COPY.gain(gain)}
              </span>
              <input
                id={id}
                type="range"
                className={soundStyles.range}
                min={EQ_GAIN_DB.min}
                max={EQ_GAIN_DB.max}
                step={1}
                value={gain}
                aria-valuetext={COPY.gain(gain)}
                onChange={(event) =>
                  setEqualizer({
                    preset: null,
                    gains: equalizer.gains.with(index, Number(event.target.value)),
                  })
                }
              />
              <label htmlFor={id} className={soundStyles.name}>
                {COPY.band(hz)}
              </label>
            </li>
          )
        })}
      </ul>
    </Setting>
  )
}

type SoundSettingsProps = { isDesktop: boolean }

/**
 * How music sounds here, kept by this browser or Raven for itself: whether
 * it plays from the file or a transcode, how its loudness is levelled, how
 * long one track fades into the next, and the equalizer.
 */
export const SoundSettings = ({ isDesktop }: SoundSettingsProps) => {
  const musicQuality = usePlayerPrefs((prefs) => prefs.musicQuality)
  const setMusicQuality = usePlayerPrefs((prefs) => prefs.setMusicQuality)
  const levelling = usePlayerPrefs((prefs) => prefs.levelling)
  const setLevelling = usePlayerPrefs((prefs) => prefs.setLevelling)
  const headingId = useId()
  const Crossfade = CROSSFADES[isDesktop ? SOUND_HOSTS.raven : SOUND_HOSTS.browser]
  return (
    <section className={soundStyles.sound} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.subheading}>
        <Titled icon="music">{COPY.heading}</Titled>
      </h3>
      <Setting
        icon="headphones"
        label={COPY.quality}
        values={Object.values(MUSIC_QUALITIES)}
        choices={SOUND_CHOICES_COPY.qualities}
        value={musicQuality}
        onChange={setMusicQuality}
      />
      <Setting
        icon="volume"
        label={COPY.levelling}
        values={Object.values(LEVELLING_MODES)}
        choices={SOUND_CHOICES_COPY.levelling}
        value={levelling}
        onChange={setLevelling}
      />
      <Crossfade />
      <Equalizer />
    </section>
  )
}

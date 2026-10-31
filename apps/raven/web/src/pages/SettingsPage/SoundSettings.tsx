import {
  CROSSFADE_SECONDS,
  EQ_BANDS,
  EQ_GAIN_DB,
  EQ_PRESET_NAMES,
  EQ_PRESETS,
  LEVELLING_MODES,
  type LevellingMode,
} from '@raven/core'
import { MUSIC_QUALITIES, usePlayerPrefs } from '@raven/ui/headless'
import { type ComponentType, useId } from 'react'
import { type AudioConnection, useAudioConnection } from '@/desktop/audioConnection'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'
import { type Choices, Setting } from '@/pages/SettingsPage/Setting'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import soundStyles from '@/pages/SettingsPage/SoundSettings.module.scss'

const COPY = SETTINGS_COPY.sound

type MusicQuality = (typeof MUSIC_QUALITIES)[keyof typeof MUSIC_QUALITIES]

const QUALITIES: Choices<MusicQuality> = {
  [MUSIC_QUALITIES.original]: {
    label: 'Original',
    hint: 'The file as it is, lossless where it was ripped so.',
  },
  [MUSIC_QUALITIES.low]: {
    label: `${MUSIC_QUALITIES.low} kbps`,
    hint: 'AAC at its smallest, for a slow or metered network.',
  },
  [MUSIC_QUALITIES.standard]: {
    label: `${MUSIC_QUALITIES.standard} kbps`,
    hint: 'AAC that few ears tell from the file.',
  },
  [MUSIC_QUALITIES.high]: {
    label: `${MUSIC_QUALITIES.high} kbps`,
    hint: 'AAC at its best.',
  },
}

const LEVELLING: Choices<LevellingMode> = {
  [LEVELLING_MODES.off]: {
    label: 'Off',
    hint: 'Every track plays as loud as it was mastered.',
  },
  [LEVELLING_MODES.track]: {
    label: 'Track',
    hint: 'Every track is brought to the same loudness, for a shuffle or a playlist.',
  },
  [LEVELLING_MODES.album]: {
    label: 'Album',
    hint: 'Every album is brought to the same loudness, its quiet and loud songs kept as they were.',
  },
}

/**
 * The equalizer's cards: each preset, and Custom, which the equalizer is
 * once a band is moved by hand; the store keeps that as no preset.
 */
const EQ_CHOICES = { ...EQ_PRESET_NAMES, custom: 'custom' } as const

type EqChoice = (typeof EQ_CHOICES)[keyof typeof EQ_CHOICES]

const PRESETS: Choices<EqChoice> = {
  [EQ_PRESET_NAMES.flat]: { label: 'Flat', hint: 'Every band as it was recorded.' },
  [EQ_PRESET_NAMES.bassBoost]: { label: 'Bass boost', hint: 'Lifts the lows.' },
  [EQ_PRESET_NAMES.trebleBoost]: { label: 'Treble boost', hint: 'Lifts the highs.' },
  [EQ_PRESET_NAMES.vocal]: { label: 'Vocal', hint: 'Brings voices forward.' },
  [EQ_PRESET_NAMES.loudness]: {
    label: 'Loudness',
    hint: 'Lifts the lows and the highs, for listening quietly.',
  },
  [EQ_CHOICES.custom]: { label: 'Custom', hint: 'The bands as set by hand below.' },
}

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
      values={Object.values(EQ_CHOICES)}
      choices={PRESETS}
      value={equalizer.preset ?? EQ_CHOICES.custom}
      onChange={(choice) =>
        setEqualizer(
          choice === EQ_CHOICES.custom
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
        choices={QUALITIES}
        value={musicQuality}
        onChange={setMusicQuality}
      />
      <Setting
        icon="volume"
        label={COPY.levelling}
        values={Object.values(LEVELLING_MODES)}
        choices={LEVELLING}
        value={levelling}
        onChange={setLevelling}
      />
      <Crossfade />
      <Equalizer />
    </section>
  )
}

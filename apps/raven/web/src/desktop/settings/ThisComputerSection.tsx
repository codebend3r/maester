import {
  AUDIO_DEVICES,
  AUDIO_PROFILES,
  type AudioProfile,
  CARRIED_FORMATS,
  carriesPassthrough,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  isPassthroughFormat,
  type OutputSettings,
} from '@raven/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ComponentType, useId, useRef, useState } from 'react'
import { refusalText } from '@/desktop/client'
import { outputQuery } from '@/desktop/output'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { THIS_COMPUTER_COPY } from '@/desktop/settings/copy'
import { Section } from '@/desktop/settings/Section'
import { useComputerName, useDesktop } from '@/stores/desktop'
import styles from '@/desktop/settings/DesktopSettings.module.scss'
import settings from '@/pages/SettingsPage/SettingsPage.module.scss'

type ProfilesForProps = { computer: string }

const profilesFor = ({
  computer,
}: ProfilesForProps): Record<AudioProfile, { label: string; hint: string }> => ({
  pcm: { label: THIS_COMPUTER_COPY.pcmLabel, hint: THIS_COMPUTER_COPY.pcmHint(computer) },
  passthrough: {
    label: THIS_COMPUTER_COPY.passthroughLabel,
    hint: THIS_COMPUTER_COPY.passthroughHint,
  },
  headphones: {
    label: THIS_COMPUTER_COPY.headphonesLabel,
    hint: THIS_COMPUTER_COPY.headphonesHint,
  },
})

const FORMAT_LABELS = {
  ac3: 'Dolby Digital (AC3)',
  dts: 'DTS',
} as const satisfies Record<(typeof CARRIED_FORMATS)[number], string>

type ProfileViewProps = {
  shown: OutputSettings
  onToggleFormat: (props: ToggleFormatProps) => void
  onSpatial: (isSpatial: boolean) => void
}

type ToggleFormatProps = {
  format: (typeof CARRIED_FORMATS)[number]
  isOn: boolean
}

/** Speakers or TV take no setting of their own. */
const NoProfileSettings = () => null

type PassthroughFormatsProps = ProfileViewProps

const PassthroughFormats = ({ shown, onToggleFormat }: PassthroughFormatsProps) => (
  <fieldset className={settings.setting}>
    <legend className={settings.legend}>{THIS_COMPUTER_COPY.formats}</legend>
    <div className={settings.choices}>
      {CARRIED_FORMATS.map((format) => (
        <label key={format} className={settings.choice}>
          <input
            type="checkbox"
            checked={shown.passthrough.includes(format)}
            onChange={(event) => onToggleFormat({ format, isOn: event.target.checked })}
          />
          <span className={settings.choiceLabel}>{FORMAT_LABELS[format]}</span>
        </label>
      ))}
    </div>
    <p className={settings.hint}>
      {THIS_COMPUTER_COPY.passthroughNote}{' '}
      {carriesPassthrough(shown)
        ? THIS_COMPUTER_COPY.volumeOnReceiver
        : THIS_COMPUTER_COPY.noFormats}
    </p>
  </fieldset>
)

type SpatialChoiceProps = ProfileViewProps

const SpatialChoice = ({ shown, onSpatial }: SpatialChoiceProps) => (
  <label className={settings.choice}>
    <input
      type="checkbox"
      checked={shown.spatial}
      onChange={(event) => onSpatial(event.target.checked)}
    />
    <span className={settings.choiceLabel}>{THIS_COMPUTER_COPY.spatial}</span>
  </label>
)

/** What each sound output adds beneath the choice. */
const PROFILE_SETTINGS = {
  [AUDIO_PROFILES.pcm]: NoProfileSettings,
  [AUDIO_PROFILES.passthrough]: PassthroughFormats,
  [AUDIO_PROFILES.headphones]: SpatialChoice,
} as const satisfies Record<AudioProfile, ComponentType<ProfileViewProps>>

type OutputPick = { id: number; apply: (base: OutputSettings) => OutputSettings }

/** How Raven sends sound from this computer: mpv's audio output, passthrough and device. */
export const ThisComputerSection = () => {
  const { client } = useDesktop()
  const computer = useComputerName()
  const profiles = profilesFor({ computer })
  const queryClient = useQueryClient()
  const ids = { profile: useId(), device: useId(), note: useId() }
  const [status, setStatus] = useState('')
  const [refusal, setRefusal] = useState('')
  // What the person chose and main has not answered yet, oldest first, shown over what main stores.
  const [picks, setPicks] = useState<readonly OutputPick[]>([])
  // One write at a time, each built from the last settings main confirmed, so a refused pick
  // never rides along in the write of a later one.
  const writes = useRef<Promise<void>>(Promise.resolve())
  const confirmed = useRef<OutputSettings | null>(null)
  const nextId = useRef(0)

  const read = useQuery(outputQuery(client))

  const stored = read.data?.output ?? null
  const shown = stored === null ? null : picks.reduce((base, pick) => pick.apply(base), stored)

  const settle = (id: number) => setPicks((current) => current.filter((pick) => pick.id !== id))

  type WriteProps = { pick: OutputPick; base: OutputSettings }

  const write = async ({ pick, base }: WriteProps) => {
    const next = pick.apply(confirmed.current ?? base)
    const reply = await client.request({ type: DESKTOP_REQUESTS.writeOutput, output: next })
    if (reply.type !== DESKTOP_REPLIES.done) {
      settle(pick.id)
      setRefusal(refusalText({ reply, fallback: THIS_COMPUTER_COPY.unsaved }))
      return
    }
    confirmed.current = next
    await queryClient.invalidateQueries({ queryKey: DESKTOP_QUERY_KEYS.output })
    settle(pick.id)
    setStatus(THIS_COMPUTER_COPY.saved)
  }

  const change = (apply: OutputPick['apply']) => {
    if (stored === null) return
    // Emptied first: a live region announces a change, so the same text twice needs a gap.
    setStatus('')
    setRefusal('')
    nextId.current += 1
    const pick = { id: nextId.current, apply }
    setPicks((current) => [...current, pick])
    const base = stored
    writes.current = writes.current
      .then(() => write({ pick, base }))
      .catch(() => setRefusal(THIS_COMPUTER_COPY.unsaved))
  }

  const choose = (changes: Partial<OutputSettings>) => change((base) => ({ ...base, ...changes }))

  const toggleFormat = ({ format, isOn }: ToggleFormatProps) =>
    change((base) => {
      const kept = base.passthrough.filter((candidate) => candidate !== format)
      const next = isOn ? [...kept, format] : kept
      return {
        ...base,
        passthrough: isPassthroughFormat.values.filter((candidate) => next.includes(candidate)),
      }
    })

  const devices = (read.data?.devices ?? []).filter((device) => device.name !== AUDIO_DEVICES.auto)
  const isListed = (name: string) => devices.some((device) => device.name === name)
  const isEngineReady = read.data?.isEngineReady ?? false
  const isDeviceListMissing = !isEngineReady || devices.length === 0
  const ProfileSettings = PROFILE_SETTINGS[shown?.profile ?? AUDIO_PROFILES.pcm]

  return (
    <Section
      icon="volume"
      title={THIS_COMPUTER_COPY.title}
      help={THIS_COMPUTER_COPY.help(computer)}
    >
      {read.isError && (
        <p className={settings.error} role="alert">
          {read.error.message}
        </p>
      )}
      {shown !== null && (
        <>
          {!isEngineReady && <p className={settings.hint}>{THIS_COMPUTER_COPY.engineNotRunning}</p>}
          <fieldset className={settings.setting}>
            <legend className={settings.legend}>{THIS_COMPUTER_COPY.soundOutput}</legend>
            <div className={settings.choices}>
              {Object.values(AUDIO_PROFILES).map((profile) => (
                <label key={profile} className={settings.choice}>
                  <input
                    type="radio"
                    name={ids.profile}
                    checked={shown.profile === profile}
                    onChange={() => choose({ profile })}
                  />
                  <span className={settings.choiceLabel}>{profiles[profile].label}</span>
                  <span className={settings.choiceHint}>{profiles[profile].hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <ProfileSettings
            shown={shown}
            onToggleFormat={toggleFormat}
            onSpatial={(isSpatial) => choose({ spatial: isSpatial })}
          />
          <div className={styles.device}>
            <label htmlFor={ids.device}>{THIS_COMPUTER_COPY.outputDevice}</label>
            <select
              id={ids.device}
              value={isListed(shown.device) ? shown.device : AUDIO_DEVICES.auto}
              disabled={!isEngineReady}
              aria-describedby={isDeviceListMissing ? ids.note : undefined}
              onChange={(event) => choose({ device: event.target.value })}
            >
              <option value={AUDIO_DEVICES.auto}>{THIS_COMPUTER_COPY.systemDefault}</option>
              {devices.map((device) => (
                <option key={device.name} value={device.name}>
                  {device.description}
                </option>
              ))}
            </select>
          </div>
          {isDeviceListMissing && (
            <p id={ids.note} className={settings.hint}>
              {THIS_COMPUTER_COPY.noDeviceList}
            </p>
          )}
        </>
      )}
      {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
      <output className={styles.said}>{status}</output>
      {refusal !== '' && (
        <p className={settings.error} role="alert">
          {refusal}
        </p>
      )}
    </Section>
  )
}

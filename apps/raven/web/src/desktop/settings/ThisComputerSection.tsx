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
import { useId, useRef, useState } from 'react'
import { refusalText } from '@/desktop/client'
import { outputQuery } from '@/desktop/output'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { Section } from '@/desktop/settings/Section'
import { useComputerName, useDesktop } from '@/stores/desktop'
import styles from '@/desktop/settings/DesktopSettings.module.scss'
import settings from '@/pages/SettingsPage/SettingsPage.module.scss'

type ProfilesForProps = { computer: string }

const profilesFor = ({
  computer,
}: ProfilesForProps): Record<AudioProfile, { label: string; hint: string }> => ({
  pcm: {
    label: 'Speakers or TV',
    hint: `Sound decoded on this ${computer}, up to 7.1, for whatever is plugged in.`,
  },
  passthrough: {
    label: 'Receiver passthrough',
    hint: 'Dolby Digital and DTS go to the receiver as they are, for it to decode.',
  },
  headphones: { label: 'Headphones', hint: 'Mixed down to stereo, or spatial on AirPods.' },
})

const FORMAT_LABELS = {
  ac3: 'Dolby Digital (AC3)',
  dts: 'DTS',
} as const satisfies Record<(typeof CARRIED_FORMATS)[number], string>

const SAVED = 'Sound output saved. It applies to the video you play next.'
const UNSAVED = 'Raven could not save the sound output. Try again.'

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
      setRefusal(refusalText({ reply, fallback: UNSAVED }))
      return
    }
    confirmed.current = next
    await queryClient.invalidateQueries({ queryKey: DESKTOP_QUERY_KEYS.output })
    settle(pick.id)
    setStatus(SAVED)
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
      .catch(() => setRefusal(UNSAVED))
  }

  const choose = (changes: Partial<OutputSettings>) => change((base) => ({ ...base, ...changes }))

  type ToggleFormatProps = {
    format: (typeof CARRIED_FORMATS)[number]
    isOn: boolean
  }

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

  return (
    <Section
      icon="volume"
      title="This computer"
      help={`How Raven sends sound from this ${computer}.`}
    >
      {read.isError && (
        <p className={settings.error} role="alert">
          {read.error.message}
        </p>
      )}
      {shown !== null && (
        <>
          {!isEngineReady && (
            <p className={settings.hint}>
              Raven's video engine is not running, so the sound settings wait until it is.
            </p>
          )}
          <fieldset className={settings.setting}>
            <legend className={settings.legend}>Sound output</legend>
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
          {shown.profile === AUDIO_PROFILES.passthrough && (
            <fieldset className={settings.setting}>
              <legend className={settings.legend}>Formats your receiver decodes</legend>
              <div className={settings.choices}>
                {CARRIED_FORMATS.map((format) => (
                  <label key={format} className={settings.choice}>
                    <input
                      type="checkbox"
                      checked={shown.passthrough.includes(format)}
                      onChange={(event) => toggleFormat({ format, isOn: event.target.checked })}
                    />
                    <span className={settings.choiceLabel}>{FORMAT_LABELS[format]}</span>
                  </label>
                ))}
              </div>
              <p className={settings.hint}>
                macOS passes Dolby Digital and DTS core to the receiver; TrueHD, DTS-HD MA and E-AC3
                play as PCM.{' '}
                {carriesPassthrough(shown)
                  ? 'Volume is set on your receiver.'
                  : 'No formats chosen, so sound plays as PCM.'}
              </p>
            </fieldset>
          )}
          {shown.profile === AUDIO_PROFILES.headphones && (
            <label className={settings.choice}>
              <input
                type="checkbox"
                checked={shown.spatial}
                onChange={(event) => choose({ spatial: event.target.checked })}
              />
              <span className={settings.choiceLabel}>Spatial audio (AirPods)</span>
            </label>
          )}
          <div className={styles.device}>
            <label htmlFor={ids.device}>Output device</label>
            <select
              id={ids.device}
              value={isListed(shown.device) ? shown.device : AUDIO_DEVICES.auto}
              disabled={!isEngineReady}
              aria-describedby={isDeviceListMissing ? ids.note : undefined}
              onChange={(event) => choose({ device: event.target.value })}
            >
              <option value={AUDIO_DEVICES.auto}>System default</option>
              {devices.map((device) => (
                <option key={device.name} value={device.name}>
                  {device.description}
                </option>
              ))}
            </select>
          </div>
          {isDeviceListMissing && (
            <p id={ids.note} className={settings.hint}>
              Device list unavailable.
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

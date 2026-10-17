import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import {
  AUDIO_DEVICES,
  AUDIO_PROFILES,
  type AudioProfile,
  isPassthroughFormat,
  type OutputSettings,
} from '@raven/core'
import { OUTPUT_KEY } from '@/renderer/PlayPage/playerServices'
import styles from '@/renderer/SettingsPage/ThisComputer.module.scss'
import { useDesktop } from '@/renderer/stores/desktop'
import { CARRIED_FORMATS, carriesPassthrough } from '@/shared/carriedOutput'
import { type AudioDevice, DESKTOP_REPLIES } from '@/shared/protocol'

/** Under `OUTPUT_KEY`, so saving invalidates this read and the Play page's together. */
const COMPUTER_KEY = [...OUTPUT_KEY, 'computer'] as const

const PROFILES = [
  { profile: 'pcm', label: 'Speakers or TV (PCM, up to 7.1)' },
  { profile: 'passthrough', label: 'Receiver passthrough' },
  { profile: 'headphones', label: 'Headphones' },
] as const satisfies readonly { profile: AudioProfile; label: string }[]

const FORMAT_LABELS = {
  ac3: 'Dolby Digital (AC3)',
  dts: 'DTS',
} as const satisfies Record<(typeof CARRIED_FORMATS)[number], string>

const FORMATS = CARRIED_FORMATS.map((format) => ({ format, label: FORMAT_LABELS[format] }))

const SAVED = 'Sound output saved. Applies to the video you play next.'
const UNREADABLE = 'raven player could not read its sound settings.'
const UNSAVED = 'raven player could not save the sound output. Try again.'

type Read = { output: OutputSettings; devices: AudioDevice[]; isEngineReady: boolean }

type Pick = { id: number; apply: (base: OutputSettings) => OutputSettings }

export const ThisComputer = ({ className }: { className?: string }) => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [refusal, setRefusal] = useState('')
  // What the person chose and main has not answered yet, oldest first, shown over what main stores.
  const [picks, setPicks] = useState<readonly Pick[]>([])
  // One write at a time, each built from the last settings main confirmed, so a refused
  // pick never rides along in the write of a later one.
  const writes = useRef<Promise<void>>(Promise.resolve())
  const confirmed = useRef<OutputSettings | null>(null)
  const nextId = useRef(0)

  const read = useQuery({
    queryKey: COMPUTER_KEY,
    queryFn: async (): Promise<Read> => {
      const reply = await client.request({ type: 'readOutput' })
      if (reply.type === DESKTOP_REPLIES.output) return reply
      throw new Error(reply.type === DESKTOP_REPLIES.refused ? reply.message : UNREADABLE)
    },
    staleTime: Infinity,
    retry: false,
  })

  const stored = read.data?.output ?? null
  const shown = stored === null ? null : picks.reduce((base, pick) => pick.apply(base), stored)

  const settle = (id: number) => setPicks((current) => current.filter((pick) => pick.id !== id))

  const write = async ({ pick, base }: { pick: Pick; base: OutputSettings }) => {
    const next = pick.apply(confirmed.current ?? base)
    const reply = await client.request({ type: 'writeOutput', output: next }).catch(() => null)
    if (reply === null || reply.type !== DESKTOP_REPLIES.done) {
      settle(pick.id)
      setRefusal(reply !== null && reply.type === DESKTOP_REPLIES.refused ? reply.message : UNSAVED)
      return
    }
    confirmed.current = next
    await queryClient.invalidateQueries({ queryKey: OUTPUT_KEY })
    settle(pick.id)
    setStatus(SAVED)
  }

  const change = (apply: Pick['apply']) => {
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

  const toggleFormat = ({
    format,
    isOn,
  }: {
    format: (typeof FORMATS)[number]['format']
    isOn: boolean
  }) =>
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
    <section className={`${styles.computer} ${className ?? ''}`} aria-labelledby="computer-title">
      <h2 id="computer-title">This computer</h2>
      <p>How raven player sends sound from this Mac.</p>
      {read.isError && <p>{read.error.message}</p>}
      {shown !== null && (
        <>
          {!isEngineReady && (
            <p>raven player's video engine is not running, so sound settings wait until it is.</p>
          )}
          <fieldset className={styles.group}>
            <legend>Sound output</legend>
            {PROFILES.map(({ profile, label }) => (
              <label key={profile} className={styles.choice}>
                <input
                  type="radio"
                  name="sound-output"
                  checked={shown.profile === profile}
                  onChange={() => choose({ profile })}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {shown.profile === AUDIO_PROFILES.passthrough && (
            <>
              <fieldset className={styles.group}>
                <legend>Formats your receiver decodes</legend>
                {FORMATS.map(({ format, label }) => (
                  <label key={format} className={styles.choice}>
                    <input
                      type="checkbox"
                      checked={shown.passthrough.includes(format)}
                      onChange={(event) => toggleFormat({ format, isOn: event.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <p>
                macOS passes Dolby Digital and DTS core to the receiver; TrueHD, DTS-HD MA and E-AC3
                play as PCM.
              </p>
              <p>
                {carriesPassthrough(shown)
                  ? 'Volume is set on your receiver.'
                  : 'No formats chosen, so sound plays as PCM.'}
              </p>
            </>
          )}
          {shown.profile === AUDIO_PROFILES.headphones && (
            <label className={styles.choice}>
              <input
                type="checkbox"
                checked={shown.spatial}
                onChange={(event) => choose({ spatial: event.target.checked })}
              />
              Spatial audio (AirPods)
            </label>
          )}
          <label className={styles.device}>
            Output device
            <select
              value={isListed(shown.device) ? shown.device : 'auto'}
              disabled={!isEngineReady}
              aria-describedby={isDeviceListMissing ? 'device-note' : undefined}
              onChange={(event) => choose({ device: event.target.value })}
            >
              <option value="auto">System default</option>
              {devices.map((device) => (
                <option key={device.name} value={device.name}>
                  {device.description}
                </option>
              ))}
            </select>
          </label>
          {isDeviceListMissing && <p id="device-note">Device list unavailable.</p>}
        </>
      )}
      {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
      <output>{status}</output>
      {refusal !== '' && (
        <p className={styles.refusal} role="alert" data-refused="true">
          {refusal}
        </p>
      )}
    </section>
  )
}

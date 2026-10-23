import {
  AUDIO_DEVICES,
  AUDIO_PROFILES,
  type AudioDevice,
  carriedFormats,
  carriesPassthrough,
  type OutputSettings,
} from '@raven/core'
import { MPV_PROPERTIES, type MpvPropertyValue } from '@raven/mpv'

/** The mpv options raven player sets that `@raven/mpv` does not read back as properties. */
export const MPV_OPTIONS = {
  volume: 'volume',
  mute: 'mute',
  subScale: 'sub-scale',
  audioDevice: 'audio-device',
  audioSpdif: 'audio-spdif',
  audioChannels: 'audio-channels',
  audioExclusive: 'audio-exclusive',
  audioNormalizeDownmix: 'audio-normalize-downmix',
  ao: 'ao',
  accessReferences: 'access-references',
  voNullFps: 'vo-null-fps',
} as const

export type MpvOption = { name: string; value: string | number | boolean }

const AUDIO_OUTPUTS = { coreaudio: 'coreaudio', avfoundation: 'avfoundation' } as const

/**
 * Each output names the other as its fallback, which mpv opens when the first fails to start.
 * CoreAudio refuses the channel layout mpv asks for on some Macs (macOS 27's built-in speakers
 * at 48 kHz answer -50), and without a fallback every title played silent.
 */
const AO_CHOICES = {
  coreaudio: `${AUDIO_OUTPUTS.coreaudio},${AUDIO_OUTPUTS.avfoundation}`,
  avfoundation: `${AUDIO_OUTPUTS.avfoundation},${AUDIO_OUTPUTS.coreaudio}`,
} as const

type AoChoice = (typeof AO_CHOICES)[keyof typeof AO_CHOICES]

const ao = ({ value, canChooseAo }: { value: AoChoice; canChooseAo: boolean }): MpvOption[] =>
  canChooseAo ? [{ name: MPV_OPTIONS.ao, value }] : []

export const isVolumeFixedFor = carriesPassthrough

export const outputOptions = ({
  output,
  devices,
  canChooseAo,
}: {
  output: OutputSettings
  devices: readonly AudioDevice[]
  canChooseAo: boolean
}): MpvOption[] => {
  const isKnownDevice =
    output.device === AUDIO_DEVICES.auto || devices.some((device) => device.name === output.device)
  const device: MpvOption = {
    name: MPV_OPTIONS.audioDevice,
    value: isKnownDevice ? output.device : AUDIO_DEVICES.auto,
  }

  if (carriesPassthrough(output)) {
    return [
      device,
      { name: MPV_OPTIONS.audioSpdif, value: carriedFormats(output).join(',') },
      { name: MPV_OPTIONS.audioChannels, value: 'auto-safe' },
      { name: MPV_OPTIONS.audioExclusive, value: true },
      { name: MPV_OPTIONS.audioNormalizeDownmix, value: false },
      ...ao({ value: AO_CHOICES.coreaudio, canChooseAo }),
      { name: MPV_OPTIONS.volume, value: 100 },
      { name: MPV_OPTIONS.mute, value: false },
    ]
  }

  if (output.profile === AUDIO_PROFILES.headphones) {
    return [
      device,
      { name: MPV_OPTIONS.audioSpdif, value: '' },
      { name: MPV_OPTIONS.audioExclusive, value: false },
      { name: MPV_OPTIONS.audioChannels, value: output.spatial ? 'auto-safe' : 'stereo' },
      { name: MPV_OPTIONS.audioNormalizeDownmix, value: !output.spatial },
      ...ao({
        value: output.spatial ? AO_CHOICES.avfoundation : AO_CHOICES.coreaudio,
        canChooseAo,
      }),
    ]
  }

  return [
    device,
    { name: MPV_OPTIONS.audioSpdif, value: '' },
    { name: MPV_OPTIONS.audioChannels, value: 'auto-safe' },
    { name: MPV_OPTIONS.audioExclusive, value: false },
    { name: MPV_OPTIONS.audioNormalizeDownmix, value: false },
    ...ao({ value: AO_CHOICES.coreaudio, canChooseAo }),
  ]
}

/** The engine's audio devices, or none without an engine or when it cannot list them. */
export const readDevices = async (
  mpv: {
    read: (input: {
      name: typeof MPV_PROPERTIES.audioDeviceList
    }) => Promise<MpvPropertyValue<typeof MPV_PROPERTIES.audioDeviceList>>
  } | null,
): Promise<AudioDevice[]> => {
  if (mpv === null) return []
  try {
    const listed = await mpv.read({ name: MPV_PROPERTIES.audioDeviceList })
    return listed.map(({ name, description }) => ({ name, description }))
  } catch {
    return []
  }
}

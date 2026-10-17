import { AUDIO_DEVICES, AUDIO_PROFILES, type OutputSettings } from '@raven/core'
import { MPV_PROPERTIES, type MpvPropertyValue } from '@raven/mpv'
import { carriedFormats, carriesPassthrough } from '@/shared/carriedOutput'
import type { AudioDevice } from '@/shared/protocol'

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

const ao = ({ name, canChooseAo }: { name: string; canChooseAo: boolean }): MpvOption[] =>
  canChooseAo ? [{ name: MPV_OPTIONS.ao, value: name }] : []

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
      ...ao({ name: 'coreaudio', canChooseAo }),
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
      ...ao({ name: output.spatial ? 'avfoundation' : 'coreaudio', canChooseAo }),
    ]
  }

  return [
    device,
    { name: MPV_OPTIONS.audioSpdif, value: '' },
    { name: MPV_OPTIONS.audioChannels, value: 'auto-safe' },
    { name: MPV_OPTIONS.audioExclusive, value: false },
    { name: MPV_OPTIONS.audioNormalizeDownmix, value: false },
    ...ao({ name: 'coreaudio', canChooseAo }),
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

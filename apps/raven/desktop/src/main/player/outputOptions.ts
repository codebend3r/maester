import {
  AUDIO_DEVICES,
  AUDIO_PROFILES,
  type AudioDevice,
  carriedFormats,
  carriesPassthrough,
  DESKTOP_PLATFORMS,
  type DesktopPlatform,
  type OutputSettings,
} from '@raven/core'
import { MPV_PROPERTIES, type MpvPropertyValue } from '@raven/mpv'

/** The mpv options Raven sets that `@raven/mpv` does not read back as properties. */
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
  af: 'af',
  replaygain: 'replaygain',
} as const

export type MpvOption = { name: string; value: string | number | boolean }

/** What a service applies when the output settings change: the settings, and the devices mpv lists. */
export type ApplyOutputProps = { output: OutputSettings; devices: readonly AudioDevice[] }

const AUDIO_OUTPUTS = {
  coreaudio: 'coreaudio',
  avfoundation: 'avfoundation',
  wasapi: 'wasapi',
} as const

/** What a choice of output is for: plain sound, or the spatial sound headphones may ask for. */
const AO_USES = { plain: 'plain', spatial: 'spatial' } as const

type AoUse = (typeof AO_USES)[keyof typeof AO_USES]

/**
 * On macOS each output names the other as its fallback, which mpv opens when the first fails
 * to start. CoreAudio refuses the channel layout mpv asks for on some Macs (macOS 27's built-in
 * speakers at 48 kHz answer -50), and without a fallback every title played silent. Windows has
 * WASAPI alone: mpv's AVFoundation output, the spatial one, exists only on macOS.
 */
const AO_CHOICES = {
  [DESKTOP_PLATFORMS.mac]: {
    plain: `${AUDIO_OUTPUTS.coreaudio},${AUDIO_OUTPUTS.avfoundation}`,
    spatial: `${AUDIO_OUTPUTS.avfoundation},${AUDIO_OUTPUTS.coreaudio}`,
  },
  [DESKTOP_PLATFORMS.windows]: {
    plain: AUDIO_OUTPUTS.wasapi,
    spatial: AUDIO_OUTPUTS.wasapi,
  },
} as const satisfies Record<DesktopPlatform, Record<AoUse, string>>

type AoProps = { use: AoUse; platform: DesktopPlatform; canChooseAo: boolean }

const ao = ({ use, platform, canChooseAo }: AoProps): MpvOption[] =>
  canChooseAo ? [{ name: MPV_OPTIONS.ao, value: AO_CHOICES[platform][use] }] : []

export const isVolumeFixedFor = carriesPassthrough

type OutputOptionsProps = {
  output: OutputSettings
  devices: readonly AudioDevice[]
  canChooseAo: boolean
  platform: DesktopPlatform
}

export const outputOptions = ({
  output,
  devices,
  canChooseAo,
  platform,
}: OutputOptionsProps): MpvOption[] => {
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
      ...ao({ use: AO_USES.plain, platform, canChooseAo }),
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
      ...ao({ use: output.spatial ? AO_USES.spatial : AO_USES.plain, platform, canChooseAo }),
    ]
  }

  return [
    device,
    { name: MPV_OPTIONS.audioSpdif, value: '' },
    { name: MPV_OPTIONS.audioChannels, value: 'auto-safe' },
    { name: MPV_OPTIONS.audioExclusive, value: false },
    { name: MPV_OPTIONS.audioNormalizeDownmix, value: false },
    ...ao({ use: AO_USES.plain, platform, canChooseAo }),
  ]
}

type ReadProps = {
  name: typeof MPV_PROPERTIES.audioDeviceList
}

/** The engine's audio devices, or none without an engine or when it cannot list them. */
export const readDevices = async (
  mpv: {
    read: (input: ReadProps) => Promise<MpvPropertyValue<typeof MPV_PROPERTIES.audioDeviceList>>
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

import type { OutputSettings } from '@raven/core'
import type { MpvPropertyValue } from '@raven/mpv'
import { carriedFormats, carriesPassthrough } from '@/shared/carriedOutput'
import type { AudioDevice } from '@/shared/protocol'

export type MpvOption = { name: string; value: string | number | boolean }

const ao = ({ name, canChooseAo }: { name: string; canChooseAo: boolean }): MpvOption[] =>
  canChooseAo ? [{ name: 'ao', value: name }] : []

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
    output.device === 'auto' || devices.some((device) => device.name === output.device)
  const device: MpvOption = { name: 'audio-device', value: isKnownDevice ? output.device : 'auto' }

  if (carriesPassthrough(output)) {
    return [
      device,
      { name: 'audio-spdif', value: carriedFormats(output).join(',') },
      { name: 'audio-channels', value: 'auto-safe' },
      { name: 'audio-exclusive', value: true },
      { name: 'audio-normalize-downmix', value: false },
      ...ao({ name: 'coreaudio', canChooseAo }),
      { name: 'volume', value: 100 },
      { name: 'mute', value: false },
    ]
  }

  if (output.profile === 'headphones') {
    return [
      device,
      { name: 'audio-spdif', value: '' },
      { name: 'audio-exclusive', value: false },
      { name: 'audio-channels', value: output.spatial ? 'auto-safe' : 'stereo' },
      { name: 'audio-normalize-downmix', value: !output.spatial },
      ...ao({ name: output.spatial ? 'avfoundation' : 'coreaudio', canChooseAo }),
    ]
  }

  return [
    device,
    { name: 'audio-spdif', value: '' },
    { name: 'audio-channels', value: 'auto-safe' },
    { name: 'audio-exclusive', value: false },
    { name: 'audio-normalize-downmix', value: false },
    ...ao({ name: 'coreaudio', canChooseAo }),
  ]
}

/** The engine's audio devices, or none without an engine or when it cannot list them. */
export const readDevices = async (
  mpv: {
    read: (input: { name: 'audio-device-list' }) => Promise<MpvPropertyValue<'audio-device-list'>>
  } | null,
): Promise<AudioDevice[]> => {
  if (mpv === null) return []
  try {
    const listed = await mpv.read({ name: 'audio-device-list' })
    return listed.map(({ name, description }) => ({ name, description }))
  } catch {
    return []
  }
}

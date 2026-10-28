import { expect, test } from 'bun:test'
import { DESKTOP_PLATFORMS, type OutputSettings } from '@raven/core'
import {
  isVolumeFixedFor,
  MPV_OPTIONS,
  outputOptions,
  readDevices,
} from '@/main/player/outputOptions'

const MAC = DESKTOP_PLATFORMS.mac

const devices = [
  { name: 'auto', description: 'Autoselect device' },
  { name: 'coreaudio/AppleUSBAudio', description: 'DAC' },
]

const base: OutputSettings = {
  profile: 'pcm',
  device: 'auto',
  passthrough: ['ac3', 'dts'],
  spatial: false,
}

const pcm = [
  { name: 'audio-device', value: 'auto' },
  { name: 'audio-spdif', value: '' },
  { name: 'audio-channels', value: 'auto-safe' },
  { name: 'audio-exclusive', value: false },
  { name: 'audio-normalize-downmix', value: false },
  { name: 'ao', value: 'coreaudio,avfoundation' },
]

test('pcm', () => {
  expect(outputOptions({ output: base, devices, canChooseAo: true, platform: MAC })).toEqual(pcm)
})

test('passthrough joins the formats and fixes the volume', () => {
  expect(
    outputOptions({
      output: { ...base, profile: 'passthrough' },
      devices,
      canChooseAo: true,
      platform: MAC,
    }),
  ).toEqual([
    { name: 'audio-device', value: 'auto' },
    { name: 'audio-spdif', value: 'ac3,dts' },
    { name: 'audio-channels', value: 'auto-safe' },
    { name: 'audio-exclusive', value: true },
    { name: 'audio-normalize-downmix', value: false },
    { name: 'ao', value: 'coreaudio,avfoundation' },
    { name: 'volume', value: 100 },
    { name: 'mute', value: false },
  ])
})

test('passthrough with no formats behaves as pcm', () => {
  expect(
    outputOptions({
      output: { ...base, profile: 'passthrough', passthrough: [] },
      devices,
      canChooseAo: true,
      platform: MAC,
    }),
  ).toEqual(pcm)
})

test('headphones downmix to stereo, or go spatial through avfoundation', () => {
  expect(
    outputOptions({
      output: { ...base, profile: 'headphones' },
      devices,
      canChooseAo: true,
      platform: MAC,
    }),
  ).toEqual([
    { name: 'audio-device', value: 'auto' },
    { name: 'audio-spdif', value: '' },
    { name: 'audio-exclusive', value: false },
    { name: 'audio-channels', value: 'stereo' },
    { name: 'audio-normalize-downmix', value: true },
    { name: 'ao', value: 'coreaudio,avfoundation' },
  ])
  expect(
    outputOptions({
      output: { ...base, profile: 'headphones', spatial: true },
      devices,
      canChooseAo: true,
      platform: MAC,
    }),
  ).toEqual([
    { name: 'audio-device', value: 'auto' },
    { name: 'audio-spdif', value: '' },
    { name: 'audio-exclusive', value: false },
    { name: 'audio-channels', value: 'auto-safe' },
    { name: 'audio-normalize-downmix', value: false },
    { name: 'ao', value: 'avfoundation,coreaudio' },
  ])
})

test('a known device is kept and an unknown one becomes auto', () => {
  const known = outputOptions({
    output: { ...base, device: 'coreaudio/AppleUSBAudio' },
    devices,
    canChooseAo: true,
    platform: MAC,
  })
  expect(known[0]).toEqual({ name: 'audio-device', value: 'coreaudio/AppleUSBAudio' })
  const unknown = outputOptions({
    output: { ...base, device: 'coreaudio/Unplugged' },
    devices,
    canChooseAo: true,
    platform: MAC,
  })
  expect(unknown[0]).toEqual({ name: 'audio-device', value: 'auto' })
  const withoutList = outputOptions({ output: base, devices: [], canChooseAo: true, platform: MAC })
  expect(withoutList[0]).toEqual({ name: 'audio-device', value: 'auto' })
})

test('canChooseAo false leaves every ao entry out', () => {
  const profiles = [
    { ...base },
    { ...base, profile: 'passthrough' },
    { ...base, profile: 'headphones' },
    { ...base, profile: 'headphones', spatial: true },
  ] as const satisfies readonly OutputSettings[]
  profiles.forEach((output) => {
    const options = outputOptions({ output, devices, canChooseAo: false, platform: MAC })
    expect(options.some((option) => option.name === MPV_OPTIONS.ao)).toBe(false)
    expect(options.length).toBeGreaterThan(0)
  })
})

test('Windows plays every profile through WASAPI, spatial headphones included', () => {
  const profiles = [
    { ...base },
    { ...base, profile: 'passthrough' },
    { ...base, profile: 'headphones' },
    { ...base, profile: 'headphones', spatial: true },
  ] as const satisfies readonly OutputSettings[]
  profiles.forEach((output) => {
    const options = outputOptions({
      output,
      devices,
      canChooseAo: true,
      platform: DESKTOP_PLATFORMS.windows,
    })
    expect(options.filter((option) => option.name === MPV_OPTIONS.ao)).toEqual([
      { name: 'ao', value: 'wasapi' },
    ])
  })
})

test('isVolumeFixedFor is true only for passthrough with a format', () => {
  expect(isVolumeFixedFor({ ...base, profile: 'passthrough' })).toBe(true)
  expect(isVolumeFixedFor({ ...base, profile: 'passthrough', passthrough: [] })).toBe(false)
  expect(isVolumeFixedFor({ ...base, profile: 'pcm' })).toBe(false)
  expect(isVolumeFixedFor({ ...base, profile: 'headphones' })).toBe(false)
})

const passthroughOf = (formats: OutputSettings['passthrough']): OutputSettings => ({
  ...base,
  profile: 'passthrough',
  passthrough: formats,
})

const spdifOf = (output: OutputSettings) =>
  outputOptions({ output, devices, canChooseAo: true, platform: MAC }).find(
    (option) => option.name === MPV_OPTIONS.audioSpdif,
  )?.value ?? null

test('passthrough emits only the formats CoreAudio carries', () => {
  expect(spdifOf(passthroughOf(['eac3', 'ac3']))).toBe('ac3')
  expect(spdifOf(passthroughOf(['truehd', 'dts-hd', 'dts', 'ac3']))).toBe('ac3,dts')
  expect(spdifOf(passthroughOf(['dts', 'dts', 'ac3']))).toBe('ac3,dts')
  expect(isVolumeFixedFor(passthroughOf(['eac3', 'ac3']))).toBe(true)
  expect(isVolumeFixedFor(passthroughOf(['truehd']))).toBe(false)
})

test('a passthrough config of uncarried formats behaves as pcm and leaves the volume free', () => {
  const uncarried: OutputSettings['passthrough'][] = [['truehd'], ['eac3', 'dts-hd']]
  uncarried.forEach((formats) => {
    const output = passthroughOf(formats)
    expect(outputOptions({ output, devices, canChooseAo: true, platform: MAC })).toEqual(pcm)
    expect(isVolumeFixedFor(output)).toBe(false)
  })
})

test('spatial only applies to headphones', () => {
  ;(['pcm', 'passthrough'] as const).forEach((profile) => {
    const options = outputOptions({
      output: { ...base, profile, spatial: true },
      devices,
      canChooseAo: true,
      platform: MAC,
    })
    expect(options).not.toContainEqual({ name: 'ao', value: 'avfoundation,coreaudio' })
    expect(options).toContainEqual({ name: 'ao', value: 'coreaudio,avfoundation' })
  })
})

test('readDevices answers the engine list, picking only name and description', async () => {
  const listed = [{ name: 'auto', description: 'Autoselect device', extra: true }]
  expect(await readDevices({ read: async () => listed })).toEqual([
    { name: 'auto', description: 'Autoselect device' },
  ])
})

test('readDevices answers nothing without an engine or when the read fails', async () => {
  expect(await readDevices(null)).toEqual([])
  expect(await readDevices({ read: () => Promise.reject(new Error('mpv is destroyed')) })).toEqual(
    [],
  )
})

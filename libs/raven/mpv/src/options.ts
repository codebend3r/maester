import type { MpvProperty } from '@/properties'

/** The mpv options raven sets that it does not read back as properties. */
export const MPV_OPTIONS = {
  volume: 'volume',
  mute: 'mute',
  subScale: 'sub-scale',
  subColor: 'sub-color',
  subFont: 'sub-font',
  subFontsDir: 'sub-fonts-dir',
  subAssOverride: 'sub-ass-override',
  subBorderStyle: 'sub-border-style',
  subOutlineColor: 'sub-outline-color',
  subOutlineSize: 'sub-outline-size',
  subShadowOffset: 'sub-shadow-offset',
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

export type MpvOptionName = (typeof MPV_OPTIONS)[keyof typeof MPV_OPTIONS]

/** What `set` may name: a property raven reads back, or an option it only sets. */
export type MpvSettable = MpvProperty | MpvOptionName

export type MpvValue = string | number | boolean

/** One option or property and the value it is set to. */
export type MpvOption = { name: MpvSettable; value: MpvValue }

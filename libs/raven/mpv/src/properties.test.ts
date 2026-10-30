import { expect, test } from 'bun:test'
import { AUDIO_DEVICES } from '@raven/core'
import {
  isMpvTrack,
  MPV_CHOICES,
  MPV_PROPERTIES,
  MPV_TRACK_TYPES,
  propertyGuards,
  type MpvProperty,
  type MpvPropertyValue,
} from '@/properties'

const examples = {
  [MPV_PROPERTIES.mpvVersion]: 'mpv 0.41.0',
  [MPV_PROPERTIES.ffmpegVersion]: '8.1.2',
  [MPV_PROPERTIES.optionsConfig]: false,
  [MPV_PROPERTIES.optionsLoadScripts]: false,
  [MPV_PROPERTIES.optionsYtdl]: false,
  [MPV_PROPERTIES.optionsOsc]: false,
  [MPV_PROPERTIES.optionsInputDefaultBindings]: false,
  [MPV_PROPERTIES.optionsInputVoKeyboard]: false,
  [MPV_PROPERTIES.optionsCache]: true,
  [MPV_PROPERTIES.optionsDemuxerMaxBytes]: 1_073_741_824,
  [MPV_PROPERTIES.optionsDemuxerMaxBackBytes]: 268_435_456,
  [MPV_PROPERTIES.timePos]: 3,
  [MPV_PROPERTIES.duration]: 12,
  [MPV_PROPERTIES.pause]: false,
  [MPV_PROPERTIES.pausedForCache]: false,
  [MPV_PROPERTIES.seeking]: false,
  [MPV_PROPERTIES.speed]: 1,
  [MPV_PROPERTIES.aid]: 1,
  [MPV_PROPERTIES.sid]: false,
  [MPV_PROPERTIES.vid]: false,
  [MPV_PROPERTIES.trackList]: [
    {
      id: 1,
      type: MPV_TRACK_TYPES.audio,
      lang: 'eng',
      'demux-channel-count': 2,
      selected: true,
      default: true,
      external: false,
      forced: false,
      'hearing-impaired': false,
      title: 'English',
      codec: 'aac',
    },
  ],
  [MPV_PROPERTIES.containerFps]: 24,
  [MPV_PROPERTIES.audioDeviceList]: [{ name: AUDIO_DEVICES.auto, description: 'Default' }],
  [MPV_PROPERTIES.demuxerCacheState]: { 'seekable-ranges': [{ start: 0, end: 12 }] },
  [MPV_PROPERTIES.hwdecCurrent]: 'videotoolbox',
  [MPV_PROPERTIES.frameDropCount]: 0,
  [MPV_PROPERTIES.decoderFrameDropCount]: 0,
  [MPV_PROPERTIES.displayFpsOverride]: 60,
  [MPV_PROPERTIES.targetColorspaceHint]: false,
} as const satisfies { [K in MpvProperty]: MpvPropertyValue<K> }

test('every named native property accepts its shape and rejects malformed values', () => {
  Object.entries(propertyGuards).forEach(([name, guard]) => {
    expect(guard(Object.getOwnPropertyDescriptor(examples, name)?.value ?? undefined)).toBe(true)
    expect(guard(undefined)).toBe(false)
    expect(guard(Number.NaN)).toBe(false)
    expect(guard(Number.POSITIVE_INFINITY)).toBe(false)
  })
  expect(propertyGuards[MPV_PROPERTIES.timePos](null)).toBe(true)
  expect(propertyGuards[MPV_PROPERTIES.duration](null)).toBe(true)
  // Real libmpv reports these unavailable (null) while idle, before and after each file.
  expect(propertyGuards[MPV_PROPERTIES.pausedForCache](null)).toBe(true)
  expect(propertyGuards[MPV_PROPERTIES.seeking](null)).toBe(true)
  ;[propertyGuards[MPV_PROPERTIES.aid], propertyGuards[MPV_PROPERTIES.sid]].forEach((guard) => {
    ;[null, 1, false, MPV_CHOICES.auto].forEach((value) => {
      expect(guard(value)).toBe(true)
    })
    ;[true, 'no', 'yes', 'invalid'].forEach((value) => {
      expect(guard(value)).toBe(false)
    })
  })
  ;[false, true, MPV_CHOICES.auto].forEach((value) => {
    expect(propertyGuards[MPV_PROPERTIES.targetColorspaceHint](value)).toBe(true)
  })
  ;['no', 'yes', 'invalid', 1, null].forEach((value) => {
    expect(propertyGuards[MPV_PROPERTIES.targetColorspaceHint](value)).toBe(false)
  })
  expect(
    propertyGuards[MPV_PROPERTIES.demuxerCacheState]({
      'seekable-ranges': [{ start: '0', end: 1 }],
    }),
  ).toBe(false)
  expect(propertyGuards[MPV_PROPERTIES.audioDeviceList]([{ name: AUDIO_DEVICES.auto }])).toBe(false)
})

test('track-list narrows optional mpv fields at the native boundary', () => {
  expect(isMpvTrack({ id: 1, type: MPV_TRACK_TYPES.audio })).toBe(true)
  expect(
    isMpvTrack({
      id: 2,
      type: MPV_TRACK_TYPES.sub,
      selected: true,
      external: false,
      default: true,
      title: 'Captions',
      codec: 'ass',
    }),
  ).toBe(true)
  expect(
    isMpvTrack({ id: 2, type: MPV_TRACK_TYPES.sub, forced: true, 'hearing-impaired': false }),
  ).toBe(true)
  expect(isMpvTrack({ id: 2, type: MPV_TRACK_TYPES.sub, forced: 'yes' })).toBe(false)
  expect(isMpvTrack({ id: 2, type: MPV_TRACK_TYPES.sub, 'hearing-impaired': 1 })).toBe(false)
  expect(isMpvTrack({ id: 1, type: 'attachment' })).toBe(false)
  expect(isMpvTrack({ id: 1, type: MPV_TRACK_TYPES.audio, lang: 42 })).toBe(false)
  expect(isMpvTrack({ id: 1, type: MPV_TRACK_TYPES.audio, 'demux-channel-count': '2' })).toBe(false)
  expect(isMpvTrack({ id: 1, type: MPV_TRACK_TYPES.sub, external: 'yes' })).toBe(false)
  expect(propertyGuards[MPV_PROPERTIES.trackList]([{ id: '1', type: MPV_TRACK_TYPES.audio }])).toBe(
    false,
  )
})

import { expect, test } from 'bun:test'
import { isMpvTrack, propertyGuards, type MpvProperty, type MpvPropertyValue } from '@/properties'

const examples = {
  'mpv-version': 'mpv 0.41.0',
  'ffmpeg-version': '8.1.2',
  'options/config': false,
  'options/load-scripts': false,
  'options/ytdl': false,
  'options/osc': false,
  'options/input-default-bindings': false,
  'options/input-vo-keyboard': false,
  'time-pos': 3,
  duration: 12,
  pause: false,
  'paused-for-cache': false,
  seeking: false,
  speed: 1,
  aid: 1,
  sid: false,
  'track-list': [
    {
      id: 1,
      type: 'audio',
      lang: 'eng',
      'demux-channel-count': 2,
      selected: true,
      default: true,
      external: false,
      title: 'English',
      codec: 'aac',
    },
  ],
  'container-fps': 24,
  'audio-device-list': [{ name: 'auto', description: 'Default' }],
  'demuxer-cache-state': { 'seekable-ranges': [{ start: 0, end: 12 }] },
  'hwdec-current': 'videotoolbox',
  'frame-drop-count': 0,
  'decoder-frame-drop-count': 0,
  'display-fps-override': 60,
  'target-colorspace-hint': false,
} as const satisfies { [K in MpvProperty]: MpvPropertyValue<K> }

test('every named native property accepts its shape and rejects malformed values', () => {
  Object.entries(propertyGuards).forEach(([name, guard]) => {
    expect(guard(Object.getOwnPropertyDescriptor(examples, name)?.value ?? undefined)).toBe(true)
    expect(guard(undefined)).toBe(false)
    expect(guard(Number.NaN)).toBe(false)
    expect(guard(Number.POSITIVE_INFINITY)).toBe(false)
  })
  expect(propertyGuards['time-pos'](null)).toBe(true)
  expect(propertyGuards['duration'](null)).toBe(true)
  ;[propertyGuards.aid, propertyGuards.sid].forEach((guard) => {
    ;[null, 1, false, 'auto'].forEach((value) => {
      expect(guard(value)).toBe(true)
    })
    ;[true, 'no', 'yes', 'invalid'].forEach((value) => {
      expect(guard(value)).toBe(false)
    })
  })
  ;[false, true, 'auto'].forEach((value) => {
    expect(propertyGuards['target-colorspace-hint'](value)).toBe(true)
  })
  ;['no', 'yes', 'invalid', 1, null].forEach((value) => {
    expect(propertyGuards['target-colorspace-hint'](value)).toBe(false)
  })
  expect(
    propertyGuards['demuxer-cache-state']({ 'seekable-ranges': [{ start: '0', end: 1 }] }),
  ).toBe(false)
  expect(propertyGuards['audio-device-list']([{ name: 'auto' }])).toBe(false)
})

test('track-list narrows optional mpv fields at the native boundary', () => {
  expect(isMpvTrack({ id: 1, type: 'audio' })).toBe(true)
  expect(
    isMpvTrack({
      id: 2,
      type: 'sub',
      selected: true,
      external: false,
      default: true,
      title: 'Captions',
      codec: 'ass',
    }),
  ).toBe(true)
  expect(isMpvTrack({ id: 1, type: 'attachment' })).toBe(false)
  expect(isMpvTrack({ id: 1, type: 'audio', lang: 42 })).toBe(false)
  expect(isMpvTrack({ id: 1, type: 'audio', 'demux-channel-count': '2' })).toBe(false)
  expect(isMpvTrack({ id: 1, type: 'sub', external: 'yes' })).toBe(false)
  expect(propertyGuards['track-list']([{ id: '1', type: 'audio' }])).toBe(false)
})

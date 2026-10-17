import { describe, expect, it } from 'bun:test'
import type { MediaTracks, PlayerEvent } from '@raven/core'
import { fromPlayerEvent, rangesFrom } from '@/components/Player/fromPlayerEvent'
import type { VideoEvent } from '@/components/Player/useVideoState'

const buffered: [number, number][] = [[0, 10]]

const tracks: MediaTracks = { audio: [], subtitles: [], defaultAudio: null, frameRate: null }

describe('rangesFrom', () => {
  it('turns start and end pairs into tuples', () => {
    expect(
      rangesFrom([
        { start: 0, end: 4 },
        { start: 8, end: 9 },
      ]),
    ).toEqual([
      [0, 4],
      [8, 9],
    ])
    expect(rangesFrom([])).toEqual([])
  })
})

describe('fromPlayerEvent', () => {
  const table: [string, PlayerEvent, VideoEvent | null][] = [
    ['time', { type: 'time', time: 12 }, { type: 'moved', time: 12, buffered }],
    [
      'buffered',
      {
        type: 'buffered',
        ranges: [
          { start: 0, end: 4 },
          { start: 8, end: 9 },
        ],
      },
      {
        type: 'buffered',
        buffered: [
          [0, 4],
          [8, 9],
        ],
      },
    ],
    ['paused', { type: 'paused', paused: true }, { type: 'paused' }],
    ['not paused', { type: 'paused', paused: false }, { type: 'played' }],
    ['waiting', { type: 'waiting', waiting: true }, { type: 'waiting' }],
    ['not waiting', { type: 'waiting', waiting: false }, { type: 'flowing' }],
    ['duration', { type: 'duration', duration: 90 }, { type: 'duration', duration: 90 }],
    ['zero duration', { type: 'duration', duration: 0 }, { type: 'duration', duration: null }],
    ['no duration', { type: 'duration', duration: null }, { type: 'duration', duration: null }],
    ['rate', { type: 'rate', rate: 1.5 }, { type: 'rate', rate: 1.5 }],
    ['ended', { type: 'ended' }, { type: 'ended' }],
    ['tracks', { type: 'tracks', tracks }, null],
    ['error', { type: 'error', reason: 'decode', message: 'bad frame' }, null],
  ]

  it.each(table)('folds %s', (_name, event, expected) => {
    expect(fromPlayerEvent({ event, buffered })).toEqual(expected)
  })
})

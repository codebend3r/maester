import type { Track } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { dayShuffle, interleaved, utcDayOf } from '@/music/mixOrder'

const DAY_MS = 24 * 60 * 60 * 1000

const NOON = Date.parse('2026-10-31T12:00:00Z')

type TrackByProps = { id: number; artist: number }

const trackBy = ({ id, artist }: TrackByProps): Track => ({
  id,
  libraryId: 1,
  albumId: 1,
  title: `Track ${id}`,
  disc: 1,
  number: id,
  duration: 200,
  artists: [{ id: artist, name: `Artist ${artist}` }],
  container: 'flac',
  codec: 'flac',
  bitrate: null,
  sampleRate: null,
  bitDepth: null,
  isLossless: true,
  mbid: null,
  addedAt: '2026-10-01T00:00:00.000Z',
  album: { title: 'Album', coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
})

const leadsOf = (tracks: readonly Track[]): (number | undefined)[] =>
  tracks.map((track) => track.artists[0]?.id)

const ITEMS = Array.from({ length: 30 }, (_, at) => at)

describe('dayShuffle', () => {
  it('deals the same order all day, in UTC, and another the next day', () => {
    const morning = dayShuffle({ items: ITEMS, now: Date.parse('2026-10-31T00:00:01Z'), key: 'a' })
    const night = dayShuffle({ items: ITEMS, now: Date.parse('2026-10-31T23:59:59Z'), key: 'a' })
    const tomorrow = dayShuffle({ items: ITEMS, now: NOON + DAY_MS, key: 'a' })

    expect(utcDayOf(NOON)).toBe('2026-10-31')
    expect(night).toEqual(morning)
    expect(tomorrow).not.toEqual(morning)
    expect(tomorrow.toSorted((a, b) => a - b)).toEqual(ITEMS)
  })

  it('deals each key its own order', () => {
    expect(dayShuffle({ items: ITEMS, now: NOON, key: 'a' })).not.toEqual(
      dayShuffle({ items: ITEMS, now: NOON, key: 'b' }),
    )
  })
})

describe('interleaved', () => {
  it('never plays an artist twice in a row when three artists make that possible', () => {
    const tracks = [
      ...[1, 2, 3, 4, 5, 6].map((id) => trackBy({ id, artist: 1 })),
      ...[7, 8, 9].map((id) => trackBy({ id, artist: 2 })),
      ...[10, 11, 12].map((id) => trackBy({ id, artist: 3 })),
    ]
    const leads = leadsOf(interleaved({ tracks }))

    expect(leads).toHaveLength(12)
    expect(leads.filter((lead, at) => at > 0 && lead === leads[at - 1])).toEqual([])
  })

  it('keeps the order given as far as the spacing allows', () => {
    const tracks = [
      trackBy({ id: 1, artist: 1 }),
      trackBy({ id: 2, artist: 1 }),
      trackBy({ id: 3, artist: 2 }),
    ]
    expect(interleaved({ tracks }).map(({ id }) => id)).toEqual([1, 3, 2])
    const front = [trackBy({ id: 4, artist: 2 }), ...tracks]
    expect(interleaved({ tracks: front }).map(({ id }) => id)).toEqual([4, 1, 3, 2])
  })

  it('plays an artist twice in a row only when nothing else is left', () => {
    const tracks = [1, 2, 3].map((id) => trackBy({ id, artist: id === 3 ? 2 : 1 }))
    const alone = [...tracks, trackBy({ id: 4, artist: 1 })]
    expect(leadsOf(interleaved({ tracks: alone }))).toEqual([1, 2, 1, 1])
  })
})

import { describe, expect, it } from 'bun:test'

import { movedUp, withoutPlace } from '@/music/playlistOrder'
import { track } from '@/test/fixtures'

const AIRBAG = track()
const PARANOID = track({ id: 102, title: 'Paranoid Android', number: 2 })
const LUCKY = track({ id: 103, title: 'Lucky', disc: 2, number: 1 })

describe('playlist order', () => {
  it('moves a track up a place, and leaves the first where it is', () => {
    const tracks = [AIRBAG, PARANOID, LUCKY]
    expect(movedUp({ tracks, index: 2 }).map(({ id }) => id)).toEqual([101, 103, 102])
    expect(movedUp({ tracks, index: 0 })).toBe(tracks)
  })

  it('takes out the track at one place only', () => {
    expect(
      withoutPlace({ tracks: [AIRBAG, PARANOID, AIRBAG], index: 2 }).map(({ id }) => id),
    ).toEqual([101, 102])
  })
})

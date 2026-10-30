import { describe, expect, it } from 'bun:test'

import { movedUp, withoutPlace } from '@/music/playlistOrder'
import { AIRBAG, LUCKY, PARANOID } from '@/test/musicServer'

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

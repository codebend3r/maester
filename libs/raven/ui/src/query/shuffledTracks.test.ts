import { describe, expect, it, mock } from 'bun:test'
import { type ApiClient, MUSIC_PAGE, MUSIC_SORTS } from '@raven/core'
import { shuffledTracksOf } from '@/query/shuffledTracks'
import { track } from '@/test/fixtures'

const AIRBAG = track({ id: 101, libraryId: 5 })
const LUCKY = track({ id: 102, libraryId: 6 })

const listTracks = mock<ApiClient['listTracks']>(async ({ libraryId }) => ({
  tracks: libraryId === 5 ? [AIRBAG] : [LUCKY],
  total: 1,
}))

describe('shuffledTracksOf', () => {
  it('asks each library for one random page under one seed, and hands their tracks back as one list', async () => {
    listTracks.mockClear()

    const tracks = await shuffledTracksOf({
      api: { listTracks },
      libraries: [{ id: 5 }, { id: 6 }],
    })

    expect(tracks).toEqual([AIRBAG, LUCKY])
    const [[first], [second]] = listTracks.mock.calls
    expect(first).toMatchObject({
      libraryId: 5,
      sort: MUSIC_SORTS.random,
      limit: MUSIC_PAGE.most,
      offset: 0,
    })
    expect(second).toMatchObject({ libraryId: 6, seed: first?.seed })
  })

  it('asks for nothing with no music library', async () => {
    listTracks.mockClear()

    expect(await shuffledTracksOf({ api: { listTracks }, libraries: [] })).toEqual([])
    expect(listTracks).not.toHaveBeenCalled()
  })
})

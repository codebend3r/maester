import { describe, expect, it } from 'bun:test'

import { type ListState, listStateOf } from '@/library/listState'
import { RESULT_STATES, resultStateOf } from '@/search/resultStates'

const READ: ListState = { failure: null, isRead: true, hasNoMusic: false }
const UNREAD: ListState = { ...READ, isRead: false }
const ANSWERED = READ
const ASKED = UNREAD
const DOWN = new Error("raven can't be reached.")

describe('resultStateOf', () => {
  it('says raven holds no music before anything else', () => {
    expect(
      resultStateOf({
        albums: { ...READ, hasNoMusic: true, failure: DOWN },
        artists: READ,
        songs: ANSWERED,
        hasAny: true,
      }),
    ).toEqual({ state: RESULT_STATES.noMusic, failure: DOWN })
  })

  it('fails with the first failure among the albums, the artists and the songs', () => {
    const songsDown = new Error('songs')
    const artistsDown = new Error('artists')
    expect(
      resultStateOf({
        albums: { ...READ, failure: DOWN },
        artists: { ...READ, failure: artistsDown },
        songs: { ...UNREAD, failure: songsDown },
        hasAny: true,
      }),
    ).toEqual({ state: RESULT_STATES.failed, failure: DOWN })
    expect(
      resultStateOf({
        albums: READ,
        artists: { ...READ, failure: artistsDown },
        songs: { ...UNREAD, failure: songsDown },
        hasAny: false,
      }),
    ).toEqual({ state: RESULT_STATES.failed, failure: artistsDown })
    expect(
      resultStateOf({
        albums: READ,
        artists: READ,
        songs: { ...UNREAD, failure: songsDown },
        hasAny: false,
      }),
    ).toEqual({ state: RESULT_STATES.failed, failure: songsDown })
  })

  it('has found some as soon as anything matched, whatever is still on its way', () => {
    expect(resultStateOf({ albums: READ, artists: UNREAD, songs: ASKED, hasAny: true })).toEqual({
      state: RESULT_STATES.found,
      failure: null,
    })
  })

  it('is searching until the albums, the artists and the songs have all answered, then empty', () => {
    const searching = { state: RESULT_STATES.searching, failure: null }
    expect(
      resultStateOf({ albums: UNREAD, artists: READ, songs: ANSWERED, hasAny: false }),
    ).toEqual(searching)
    expect(
      resultStateOf({ albums: READ, artists: UNREAD, songs: ANSWERED, hasAny: false }),
    ).toEqual(searching)
    expect(resultStateOf({ albums: READ, artists: READ, songs: ASKED, hasAny: false })).toEqual(
      searching,
    )
    expect(resultStateOf({ albums: READ, artists: READ, songs: ANSWERED, hasAny: false })).toEqual({
      state: RESULT_STATES.empty,
      failure: null,
    })
  })

  /*
   * Search's songs are one query folded with the music libraries by `listStateOf`, as its albums
   * and artists are. Folded or read raw, the answer is the same wherever the query and the
   * libraries stand.
   */
  it('reads the songs folded with the libraries as it would the query alone', () => {
    const songsDown = new Error('songs')
    const either = [false, true] as const
    const musics = either.flatMap((isRead) =>
      [null, DOWN].flatMap((failure) =>
        [[], [1]].map((libraries) => ({ libraries, isRead, failure })),
      ),
    )
    const queries = either.flatMap((isSuccess) =>
      [null, songsDown].map((error) => ({ error, isSuccess })),
    )
    const cases = musics.flatMap((music) =>
      queries.flatMap((songs) =>
        queries.flatMap((albums) => either.map((hasAny) => ({ music, songs, albums, hasAny }))),
      ),
    )
    expect(cases).toHaveLength(256)
    cases.forEach(({ music, songs, albums, hasAny }) => {
      const listing = listStateOf({ music, failure: albums.error, isRead: albums.isSuccess })
      const folded = resultStateOf({
        albums: listing,
        artists: listing,
        songs: listStateOf({ music, failure: songs.error, isRead: songs.isSuccess }),
        hasAny,
      })
      const raw = resultStateOf({
        albums: listing,
        artists: listing,
        songs: { failure: songs.error, isRead: songs.isSuccess, hasNoMusic: false },
        hasAny,
      })
      expect(folded).toEqual(raw)
    })
  })
})

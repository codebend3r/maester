import { describe, expect, it } from 'bun:test'
import { TOP_SHELF_KINDS } from '@raven/top-shelf/contract'
import { HOME_COPY, TOP_SHELF_COPY } from '@raven/wren'
import { OK_COMPUTER } from '@raven/wren/testing'
import type { CoverOf } from '@raven/wren-native'

import { SIGNED_OUT_SHELF, TOP_SHELF_ALBUMS, releasesShelfOf } from '@/topShelf/topShelf'

const HEADERS = { authorization: 'Bearer t' }

// A cover for every album with a version, as `useCovers` hands them out.
const coverOf: CoverOf = ({ albumId, coverVersion }) =>
  coverVersion === null
    ? null
    : { uri: `https://raven/api/albums/${albumId}/cover/${coverVersion}`, headers: HEADERS }

const WITH_COVER = { ...OK_COMPUTER, coverVersion: 'c7' }

describe("Wren's Top Shelf", () => {
  it('asks the listener to sign in while nobody is, opening sign-in', () => {
    expect(SIGNED_OUT_SHELF).toEqual({
      kind: TOP_SHELF_KINDS.signedOut,
      title: TOP_SHELF_COPY.signIn,
      openUrl: 'wren-tv://sign-in',
    })
  })

  it('shows the latest releases as covers, each opening its album', () => {
    expect(releasesShelfOf({ albums: [WITH_COVER], coverOf })).toEqual({
      kind: TOP_SHELF_KINDS.sectioned,
      title: HOME_COPY.latestReleases,
      items: [
        {
          id: 'album-7',
          title: 'OK Computer',
          summary: null,
          picture: { uri: 'https://raven/api/albums/7/cover/c7', headers: HEADERS },
          playUrl: null,
          openUrl: 'wren-tv://album/7',
        },
      ],
    })
  })

  it('leaves off an album with no cover, and holds no more than a row', () => {
    const albums = [OK_COMPUTER, ...Array.from({ length: 20 }, () => WITH_COVER)]
    const shelf = releasesShelfOf({ albums, coverOf })
    expect(shelf.kind === TOP_SHELF_KINDS.sectioned && shelf.items.length).toBe(
      TOP_SHELF_ALBUMS - 1,
    )
  })
})

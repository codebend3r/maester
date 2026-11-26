import { describe, expect, it } from 'bun:test'
import { AUTH_HEADERS } from '@raven/core'
import { TOP_SHELF_KINDS, TOP_SHELF_LAYOUTS } from '@raven/top-shelf/contract'

import type { ShowArts } from '@/queries/showArt'
import { HOME, NAS, homeApi } from '@/test/homeServer'
import { SIGNED_OUT_SHELF, TOP_SHELF_COPY, continueShelfOf } from '@/topShelf/topShelf'

const COOKIE = { [AUTH_HEADERS.cookie]: 'raven_unlock=u.1' }
const headersFor = () => COOKIE

/** No art read yet. */
const NO_ARTS: ShowArts = new Map()

describe('the Top Shelf', () => {
  it('asks the viewer to sign in while nobody is, opening sign-in', () => {
    expect(SIGNED_OUT_SHELF).toEqual({
      kind: TOP_SHELF_KINDS.signedOut,
      title: TOP_SHELF_COPY.signIn,
      openUrl: 'raven://sign-in',
    })
  })

  it('shows Continue watching as a carousel on each backdrop, playing from the saved spot', () => {
    const shelf = continueShelfOf({
      entries: HOME.inProgress,
      arts: NO_ARTS,
      api: homeApi(),
      headersFor,
    })
    expect(shelf).toEqual({
      kind: TOP_SHELF_KINDS.titles,
      layout: TOP_SHELF_LAYOUTS.carousel,
      title: 'Continue watching',
      items: [
        {
          id: 'media:20',
          title: 'Busboys',
          summary: '2026 · 1h 15m left',
          picture: { uri: `${NAS.origin}/api/pictures/items/40/backdrop/b40`, headers: COOKIE },
          playUrl: 'raven://play/20',
          openUrl: 'raven://item/40?library=1',
        },
      ],
    })
  })

  it('holds no more than Home shows', () => {
    const [entry] = HOME.inProgress
    if (entry === undefined) throw new Error('HOME has a video in progress')
    const entries = Array.from({ length: 9 }, () => entry)
    const shelf = continueShelfOf({ entries, arts: NO_ARTS, api: homeApi(), headersFor })
    expect(shelf.kind === TOP_SHELF_KINDS.titles && shelf.items.length).toBe(6)
  })
})

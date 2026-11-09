import { describe, expect, it } from 'bun:test'

import { LINK_KINDS, videoLinksOf } from '@/queries/itemLinks'
import { ROUTE_TARGETS, itemTarget } from '@/routes'
import { ITEM_LINK_COPY } from '@/queries/copy'
import { FILMS } from '@/test/homeServer'
import {
  BUSBOYS,
  BUSBOYS_SAGA,
  GOOD_NEWS_ABOUT_HELL,
  SEVERANCE,
  SEVERANCE_ONE,
} from '@/test/itemServer'

describe('videoLinksOf', () => {
  it("offers an episode its show, and its season once the show's page names it", () => {
    expect(
      videoLinksOf({
        details: GOOD_NEWS_ABOUT_HELL,
        show: SEVERANCE,
        libraryId: FILMS.id,
        sagas: [],
      }),
    ).toEqual([
      {
        kind: LINK_KINDS.show,
        label: ITEM_LINK_COPY.goTo(SEVERANCE.title),
        text: SEVERANCE.title,
        target: itemTarget(SEVERANCE.id),
      },
      {
        kind: LINK_KINDS.season,
        label: ITEM_LINK_COPY.goTo(SEVERANCE_ONE.title),
        text: 'S01',
        target: itemTarget(SEVERANCE_ONE.id),
      },
    ])
  })

  it('offers only the show while its page is not read yet', () => {
    expect(
      videoLinksOf({
        details: GOOD_NEWS_ABOUT_HELL,
        show: null,
        libraryId: FILMS.id,
        sagas: [],
      }).map(({ kind }) => kind),
    ).toEqual([LINK_KINDS.show])
  })

  it('offers a movie its saga when its library lists it in one, and nothing otherwise', () => {
    expect(
      videoLinksOf({ details: BUSBOYS, show: null, libraryId: FILMS.id, sagas: [BUSBOYS_SAGA] }),
    ).toEqual([
      {
        kind: LINK_KINDS.saga,
        label: ITEM_LINK_COPY.viewSaga(BUSBOYS_SAGA.name),
        text: BUSBOYS_SAGA.name,
        target: { kind: ROUTE_TARGETS.saga, libraryId: FILMS.id, sagaId: BUSBOYS_SAGA.tmdbId },
      },
    ])
    expect(videoLinksOf({ details: BUSBOYS, show: null, libraryId: FILMS.id, sagas: [] })).toEqual(
      [],
    )
  })

  it('offers a file with no page nothing', () => {
    expect(videoLinksOf({ details: null, show: null, libraryId: FILMS.id, sagas: [] })).toEqual([])
  })
})

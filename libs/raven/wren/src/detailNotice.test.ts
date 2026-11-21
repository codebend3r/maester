import { describe, expect, it } from 'bun:test'
import { ROUTE_STATES } from '@raven/core'

import { ALBUM_COPY } from '@/copy/screens'
import { detailNoticeOf } from '@/detailNotice'

describe('detailNoticeOf', () => {
  it('says the page is opening while it is read', () => {
    expect(detailNoticeOf({ page: { state: ROUTE_STATES.loading }, copy: ALBUM_COPY })).toBe(
      ALBUM_COPY.opening,
    )
  })

  it('says the server has none by that address', () => {
    expect(detailNoticeOf({ page: { state: ROUTE_STATES.missing }, copy: ALBUM_COPY })).toBe(
      ALBUM_COPY.missing,
    )
  })

  it("says why the server could not say, in the server's words", () => {
    const page = { state: ROUTE_STATES.error, message: 'raven is out of reach' }
    expect(detailNoticeOf({ page, copy: ALBUM_COPY })).toBe('raven is out of reach')
  })
})

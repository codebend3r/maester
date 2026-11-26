import { describe, expect, it } from 'bun:test'

import { WREN_ICONS } from '@/icons'
import { LIBRARY_ICONS, LIBRARY_ORDER, LIBRARY_SEGMENTS } from '@/library/segments'

describe('LIBRARY_ICONS', () => {
  it('draws every category Library lists', () => {
    expect(LIBRARY_ORDER.every((segment) => Object.hasOwn(LIBRARY_ICONS, segment))).toBe(true)
  })

  it('draws each category as its row does', () => {
    expect(LIBRARY_ICONS[LIBRARY_SEGMENTS.albums]).toBe(WREN_ICONS.album)
    expect(LIBRARY_ICONS[LIBRARY_SEGMENTS.unmatchedAlbums]).toBe(WREN_ICONS.alert)
    expect(LIBRARY_ICONS[LIBRARY_SEGMENTS.inProgress]).toBe(WREN_ICONS.recent)
    expect(LIBRARY_ICONS[LIBRARY_SEGMENTS.downloads]).toBe(WREN_ICONS.downloads)
  })
})

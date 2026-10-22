import { PAGE_PATHS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { isFilePlaying, isOfflinePage, isPlaying, playPathOf, DESKTOP_PATHS } from '@/desktop/paths'
import { FILE_ID } from '@/test/desktop'

describe('desktop paths', () => {
  it('plays a file at its own path', () => {
    expect(playPathOf(FILE_ID)).toBe(`/play/${FILE_ID}`)
  })

  it('knows the pages that need no server', () => {
    expect(isOfflinePage(DESKTOP_PATHS.downloads)).toBe(true)
    expect(isOfflinePage(DESKTOP_PATHS.local)).toBe(true)
    expect(isOfflinePage(PAGE_PATHS.settings)).toBe(true)
    expect(isOfflinePage(`/play/${FILE_ID}`)).toBe(true)
    expect(isOfflinePage('/')).toBe(false)
    expect(isOfflinePage('/libraries/3')).toBe(false)
  })

  it('knows when a local file or download is playing', () => {
    expect(isFilePlaying(`/play/${FILE_ID}`)).toBe(true)
    expect(isFilePlaying(`${PAGE_PATHS.watch}/7`)).toBe(false)
    expect(isFilePlaying(DESKTOP_PATHS.downloads)).toBe(false)
  })

  it('knows when a video is on screen', () => {
    expect(isPlaying(`/play/${FILE_ID}`)).toBe(true)
    expect(isPlaying(`${PAGE_PATHS.watch}/7`)).toBe(true)
    expect(isPlaying(DESKTOP_PATHS.downloads)).toBe(false)
  })
})

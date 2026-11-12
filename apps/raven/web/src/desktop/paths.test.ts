import { DESKTOP_PATHS, PAGE_PATHS, watchPageOf } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import {
  downloadsPageFor,
  isFilePlaying,
  DESKTOP_OFFLINE_PAGES,
  isOfflinePage,
  isPlaying,
  playOriginFor,
  playPathOf,
} from '@/desktop/paths'
import { BROWSER_OFFLINE_PAGES, browserPlayPathOf } from '@/browserDownloads/paths'
import { MUSIC_PATHS } from '@/lib/music'
import { FILE_ID } from '@/test/desktop'

const isOffline = (pathname: string): boolean =>
  isOfflinePage({ pathname, pages: DESKTOP_OFFLINE_PAGES })

describe('desktop paths', () => {
  it('plays a file at its own path', () => {
    expect(playPathOf(FILE_ID)).toBe(`/play/${FILE_ID}`)
  })

  it('knows the pages that need no server', () => {
    expect(isOffline(DESKTOP_PATHS.downloads)).toBe(true)
    expect(isOffline(DESKTOP_PATHS.local)).toBe(true)
    expect(isOffline(PAGE_PATHS.settings)).toBe(true)
    expect(isOffline(`/play/${FILE_ID}`)).toBe(true)
    expect(isOffline('/music/downloads')).toBe(true)
    expect(isOffline('/music/albums/7')).toBe(false)
    expect(isOffline('/')).toBe(false)
    expect(isOffline('/libraries/3')).toBe(false)
  })

  it('opens the pages a browser that keeps downloads shows with no server', () => {
    const isBrowserOffline = (pathname: string): boolean =>
      isOfflinePage({ pathname, pages: BROWSER_OFFLINE_PAGES })
    expect(isBrowserOffline(DESKTOP_PATHS.downloads)).toBe(true)
    expect(isBrowserOffline(browserPlayPathOf(FILE_ID))).toBe(true)
    expect(isBrowserOffline(watchPageOf(7))).toBe(true)
    expect(isBrowserOffline(PAGE_PATHS.settings)).toBe(true)
    expect(isBrowserOffline(DESKTOP_PATHS.local)).toBe(false)
    expect(isBrowserOffline(MUSIC_PATHS.downloads)).toBe(false)
    expect(isFilePlaying(browserPlayPathOf(FILE_ID))).toBe(true)
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

  it('picks the Downloads of the mode a page is in', () => {
    expect(downloadsPageFor('/music/albums/7')).toBe('/music/downloads')
    expect(downloadsPageFor('/libraries/3')).toBe(DESKTOP_PATHS.downloads)
  })

  it('keeps the Downloads a file was opened from, from one file to the next', () => {
    const pathname = `/play/${FILE_ID}`
    expect(playOriginFor({ state: { from: '/music/downloads' }, pathname })).toBe(
      '/music/downloads',
    )
    expect(playOriginFor({ state: { from: '/elsewhere' }, pathname })).toBe(DESKTOP_PATHS.downloads)
    expect(playOriginFor({ state: null, pathname: '/music/downloads' })).toBe('/music/downloads')
  })
})

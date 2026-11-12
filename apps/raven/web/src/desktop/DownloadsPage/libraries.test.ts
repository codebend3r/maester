import { describe, expect, it } from 'bun:test'
import { DOWNLOAD_KINDS, type DownloadLibrary } from '@raven/core'
import {
  hasPrivateDownloads,
  sectionsOf,
  visibleDownloadsOf,
} from '@/desktop/DownloadsPage/libraries'
import { DOWNLOADS_SHOWS } from '@/stores/downloadsShow'
import { viewOf } from '@/test/desktop'

const MOVIES: DownloadLibrary = { id: 1, name: 'Movies', isPrivate: false }
const ANIME: DownloadLibrary = { id: 2, name: 'Anime', isPrivate: false }
const HOME: DownloadLibrary = { id: 3, name: 'Home videos', isPrivate: true }

type TitledProps = { n: number; title: string; library: DownloadLibrary | null }

const titled = ({ n, title, library }: TitledProps) =>
  viewOf({
    downloadId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    label: title,
    group: { kind: DOWNLOAD_KINDS.movie, key: `movie:${n}`, title, order: 0 },
    library,
  })

const DUNE = titled({ n: 1, title: 'Dune', library: MOVIES })
const AKIRA = titled({ n: 2, title: 'Akira', library: ANIME })
const ALIEN = titled({ n: 3, title: 'Alien', library: MOVIES })
const OLD = titled({ n: 4, title: 'From before', library: null })
const BIRTHDAY = titled({ n: 5, title: 'Birthday', library: HOME })

const ALL = [DUNE, OLD, AKIRA, ALIEN, BIRTHDAY]

describe('visibleDownloadsOf', () => {
  it("leaves a private library's downloads out until the PIN is entered", () => {
    expect(visibleDownloadsOf({ downloads: ALL, isUnlocked: false })).toEqual([
      DUNE,
      OLD,
      AKIRA,
      ALIEN,
    ])
  })

  it('shows every download once the PIN is entered', () => {
    expect(visibleDownloadsOf({ downloads: ALL, isUnlocked: true })).toEqual(ALL)
  })

  it('shows a download whose library is not known yet either way', () => {
    expect(visibleDownloadsOf({ downloads: [OLD], isUnlocked: false })).toEqual([OLD])
  })
})

describe('hasPrivateDownloads', () => {
  it('is whether any download came from a private library', () => {
    expect(hasPrivateDownloads(ALL)).toBe(true)
    expect(hasPrivateDownloads([DUNE, OLD])).toBe(false)
    expect(hasPrivateDownloads([])).toBe(false)
  })
})

describe('sectionsOf', () => {
  it('keeps everything in one unheaded run, in the order it came', () => {
    expect(sectionsOf({ downloads: ALL, show: DOWNLOADS_SHOWS.everything })).toEqual([
      { key: 'everything', name: null, downloads: ALL },
    ])
  })

  it('has no section for no downloads, whichever way it shows them', () => {
    expect(sectionsOf({ downloads: [], show: DOWNLOADS_SHOWS.everything })).toEqual([])
    expect(sectionsOf({ downloads: [], show: DOWNLOADS_SHOWS.byLibrary })).toEqual([])
  })

  it('files each download under its library, by name, with the unknown last under Other', () => {
    expect(sectionsOf({ downloads: ALL, show: DOWNLOADS_SHOWS.byLibrary })).toEqual([
      { key: 'library:2', name: 'Anime', downloads: [AKIRA] },
      { key: 'library:3', name: 'Home videos', downloads: [BIRTHDAY] },
      { key: 'library:1', name: 'Movies', downloads: [DUNE, ALIEN] },
      { key: 'other', name: 'Other', downloads: [OLD] },
    ])
  })

  it('keeps two libraries of one name apart, by id', () => {
    const twin = titled({ n: 6, title: 'Twin', library: { ...MOVIES, id: 9 } })
    const sections = sectionsOf({ downloads: [DUNE, twin], show: DOWNLOADS_SHOWS.byLibrary })
    expect(sections.map(({ key }) => key)).toEqual(['library:1', 'library:9'])
  })

  it('has no Other section when every library is known', () => {
    const sections = sectionsOf({ downloads: [DUNE, AKIRA], show: DOWNLOADS_SHOWS.byLibrary })
    expect(sections.map(({ name }) => name)).toEqual(['Anime', 'Movies'])
  })
})

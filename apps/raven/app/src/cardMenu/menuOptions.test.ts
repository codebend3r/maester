import { describe, expect, it } from 'bun:test'
import {
  ITEM_TYPES,
  type ItemSummary,
  MUSIC_FACTS,
  MUSIC_LINKS,
  MUSIC_LINK_COPY,
  type MusicLink,
  WATCHED_STATES,
} from '@raven/core'
import { mediaItemFor, summaryFor } from '@raven/native/testing'

import {
  CARD_MENU_COPY,
  aboutOf,
  bingeOptionOf,
  deleteOptionOf,
  downloadOptionOf,
  favouriteOptionOf,
  isOptionBlocked,
  linkOptionOf,
  musicLinkOptionOf,
  readingNoteOf,
  watchedOptionOf,
} from '@/cardMenu/menuOptions'
import { DOWNLOAD_COPY } from '@/downloads/copy'
import { DOWNLOAD_ACTIONS, type DownloadControl } from '@/downloads/downloadControl'
import { type ItemLink, LINK_KINDS } from '@/queries/itemLinks'
import { itemTarget } from '@/routes'

/** A Download button's face as a fresh title's page draws it. */
const DOWNLOAD: DownloadControl = {
  label: DOWNLOAD_COPY.downloadAll('Season 1'),
  text: DOWNLOAD_COPY.download,
  icon: 'download',
  isOn: false,
  isDisabled: false,
  action: DOWNLOAD_ACTIONS.download,
}

describe('linkOptionOf', () => {
  it('offers a way up by its words and opens it when pressed', () => {
    const link: ItemLink = {
      kind: LINK_KINDS.show,
      label: 'Go to Severance',
      text: 'Severance',
      target: itemTarget(4),
    }
    const opened: ItemLink[] = []
    const option = linkOptionOf({ link, onOpen: (each) => opened.push(each) })
    expect(option.label).toBe('Go to Severance')
    expect(isOptionBlocked(option)).toBe(false)
    option.onPress()
    expect(opened).toEqual([link])
  })
})

describe('downloadOptionOf', () => {
  it("offers Download as the page's button says it, and presses the button", () => {
    const pressed: string[] = []
    const [option] = downloadOptionOf({ control: DOWNLOAD, onPress: () => pressed.push('down') })
    expect(option?.label).toBe(DOWNLOAD_COPY.downloadAll('Season 1'))
    expect(option?.blockedBy).toBeNull()
    option?.onPress()
    expect(pressed).toEqual(['down'])
  })

  it('offers Cancel download while it is on its way, Retry once it failed, Remove once it is here', () => {
    const labelOf = (action: DownloadControl['action']) =>
      downloadOptionOf({ control: { ...DOWNLOAD, action }, onPress: () => undefined })[0]?.label
    expect(labelOf(DOWNLOAD_ACTIONS.cancel)).toBe(CARD_MENU_COPY.cancelDownload)
    expect(labelOf(DOWNLOAD_ACTIONS.retry)).toBe(CARD_MENU_COPY.retryDownload)
    expect(labelOf(DOWNLOAD_ACTIONS.remove)).toBe(CARD_MENU_COPY.removeDownload)
  })

  it('keeps a faint Download with why under it where this device can take none of it', () => {
    const blocked: DownloadControl = {
      ...DOWNLOAD,
      label: DOWNLOAD_COPY.cantDownload,
      isDisabled: true,
      action: DOWNLOAD_ACTIONS.none,
    }
    const [option] = downloadOptionOf({ control: blocked, onPress: () => undefined })
    expect(option?.label).toBe(DOWNLOAD_COPY.download)
    expect(option?.blockedBy).toBe(DOWNLOAD_COPY.cantDownload)
    expect(option === undefined ? false : isOptionBlocked(option)).toBe(true)
  })

  it('offers nothing for a button with nothing to press and nothing to say', () => {
    const idle: DownloadControl = { ...DOWNLOAD, action: DOWNLOAD_ACTIONS.none }
    expect(downloadOptionOf({ control: idle, onPress: () => undefined })).toEqual([])
  })
})

describe('watchedOptionOf', () => {
  it('offers to mark what is not all watched, and to unmark what is', () => {
    const pressed: string[] = []
    const mark = watchedOptionOf({
      state: WATCHED_STATES.partly,
      onToggle: () => pressed.push('toggled'),
    })
    expect(mark.label).toBe(CARD_MENU_COPY.markWatched)
    expect(isOptionBlocked(mark)).toBe(false)
    mark.onPress()
    expect(pressed).toEqual(['toggled'])
    expect(
      watchedOptionOf({ state: WATCHED_STATES.watched, onToggle: () => undefined }).label,
    ).toBe(CARD_MENU_COPY.markUnwatched)
  })
})

describe('favouriteOptionOf', () => {
  it('adds a title that is no favourite and removes one that is, sending the new mark', () => {
    const marks: boolean[] = []
    const add = favouriteOptionOf({ isOn: false, onToggle: (isMarked) => marks.push(isMarked) })
    const remove = favouriteOptionOf({ isOn: true, onToggle: (isMarked) => marks.push(isMarked) })
    expect(add.label).toBe(CARD_MENU_COPY.addFavourite)
    expect(remove.label).toBe(CARD_MENU_COPY.removeFavourite)
    add.onPress()
    remove.onPress()
    expect(marks).toEqual([true, false])
  })
})

describe('bingeOptionOf', () => {
  it('adds a show, removes one binging, and says why it cannot while the list is full', () => {
    const toggle = () => undefined
    expect(bingeOptionOf({ isBinging: false, isFull: false, toggle }).label).toBe(
      CARD_MENU_COPY.addBinge,
    )
    expect(bingeOptionOf({ isBinging: true, isFull: false, toggle }).label).toBe(
      CARD_MENU_COPY.removeBinge,
    )
    const full = bingeOptionOf({ isBinging: false, isFull: true, toggle })
    expect(full.blockedBy).toBe(CARD_MENU_COPY.bingeFull)
    expect(isOptionBlocked(full)).toBe(true)
  })
})

describe('readingNoteOf', () => {
  it('says the title is being read, or that the read failed', () => {
    expect(readingNoteOf(false)).toBe(CARD_MENU_COPY.reading)
    expect(readingNoteOf(true)).toBe(CARD_MENU_COPY.failed)
  })
})

describe('deleteOptionOf', () => {
  const media = mediaItemFor({ id: 4, libraryId: 1, title: 'Clip', fileName: 'Clip.mkv' })
  const labelOf = (type: ItemSummary['type'] | null): string =>
    deleteOptionOf({
      media: { ...media, item: type === null ? null : summaryFor({ id: 9, type, title: 'Clip' }) },
      onDelete: () => undefined,
    }).label

  it('names an episode and a movie, and calls any other file a video', () => {
    expect(labelOf(ITEM_TYPES.episode)).toBe(CARD_MENU_COPY.deleteEpisode)
    expect(labelOf(ITEM_TYPES.movie)).toBe(CARD_MENU_COPY.deleteMovie)
    expect(labelOf(null)).toBe(CARD_MENU_COPY.deleteVideo)
  })

  it('is the one line a sheet marks as what cannot be undone, and asks on its press', () => {
    const asked: string[] = []
    const option = deleteOptionOf({ media, onDelete: () => asked.push('ask') })
    expect(option.isDestructive).toBe(true)
    option.onPress()
    expect(asked).toEqual(['ask'])
  })
})

describe('the music menu', () => {
  it('says an album or a track a fact a line, each by its name', () => {
    expect(
      aboutOf([
        { key: MUSIC_FACTS.artists, value: 'Radiohead' },
        { key: MUSIC_FACTS.released, value: '1997' },
      ]),
    ).toBe('Artist: Radiohead\nReleased: 1997')
    expect(aboutOf([])).toBeNull()
  })

  it('goes to the album, to its one artist, or to each of several by name, keyed apart', () => {
    const opened: MusicLink[] = []
    const onOpen = (link: MusicLink) => opened.push(link)
    const album: MusicLink = { kind: MUSIC_LINKS.album, albumId: 7 }
    const one: MusicLink = {
      kind: MUSIC_LINKS.artist,
      artistId: 1,
      name: 'Radiohead',
      isNamed: false,
    }
    const named: MusicLink = {
      kind: MUSIC_LINKS.artist,
      artistId: 2,
      name: 'Thom Yorke',
      isNamed: true,
    }
    const options = [album, one, named].map((link) => musicLinkOptionOf({ link, onOpen }))
    expect(options.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'album', label: MUSIC_LINK_COPY.goToAlbum },
      { key: 'artist:1', label: MUSIC_LINK_COPY.goToArtist },
      { key: 'artist:2', label: 'Go to Thom Yorke' },
    ])
    options[2]?.onPress()
    expect(opened).toEqual([named])
  })
})

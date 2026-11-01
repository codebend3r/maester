import { describe, expect, it } from 'bun:test'
import {
  DOWNLOAD_TARGET_KINDS,
  PLAY_LINK_MAX_NEXT,
  downloadLinkFor,
  isDownloadTarget,
  isMediaId,
  playLinkFor,
} from '@/playLink'

describe('isMediaId', () => {
  it.each([1, 7, 9007199254740991])('accepts %p', (value) => {
    expect(isMediaId(value)).toBe(true)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined, 2 ** 53])(
    'rejects %p',
    (value) => {
      expect(isMediaId(value)).toBe(false)
    },
  )
})

describe('playLinkFor', () => {
  const origin = 'https://raven.example'

  it('writes the server, the title, where to start and what is next', () => {
    expect(playLinkFor({ origin, mediaId: 7, at: 12.9, next: [8, 9] })).toBe(
      'raven://play?server=https%3A%2F%2Fraven.example&media=7&at=12&next=8%2C9',
    )
  })

  it('leaves out next when nothing follows', () => {
    const link = playLinkFor({ origin, mediaId: 7, at: 0, next: [] })
    expect(link).toBe('raven://play?server=https%3A%2F%2Fraven.example&media=7&at=0')
    expect(link).not.toContain('next')
  })

  it('carries only the first hundred ids of a longer queue', () => {
    const next = Array.from({ length: 150 }, (_, index) => index + 1)
    const link = playLinkFor({ origin, mediaId: 7, at: 0, next })
    const carried = decodeURIComponent(link.split('next=')[1] ?? '').split(',')
    expect(carried).toHaveLength(PLAY_LINK_MAX_NEXT)
    expect(carried[0]).toBe('1')
    expect(carried.at(-1)).toBe('100')
  })

  it('leaves out next ids that are not media ids, then carries the first hundred', () => {
    const next = [
      0,
      -1,
      1.5,
      Number.NaN,
      2 ** 53,
      ...Array.from({ length: 101 }, (_, index) => index + 1),
    ]
    const link = playLinkFor({ origin, mediaId: 7, at: 0, next })
    const carried = decodeURIComponent(link.split('next=')[1] ?? '').split(',')
    expect(carried).toHaveLength(PLAY_LINK_MAX_NEXT)
    expect(carried[0]).toBe('1')
    expect(carried.at(-1)).toBe('100')
  })

  it('leaves out next when none of its ids are media ids', () => {
    expect(playLinkFor({ origin, mediaId: 7, at: 0, next: [0, -2] })).not.toContain('next')
  })

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53])(
    'refuses to write a link for the title %p',
    (mediaId) => {
      expect(() => playLinkFor({ origin, mediaId, at: 0, next: [] })).toThrow('not a media id')
    },
  )

  it('writes a negative start as 0', () => {
    expect(playLinkFor({ origin, mediaId: 7, at: -5, next: [] })).toContain('&at=0')
  })
})

describe('downloadLinkFor', () => {
  const origin = 'https://raven.example'

  it('names a file', () => {
    expect(downloadLinkFor({ origin, target: { kind: 'media', mediaId: 7 } })).toBe(
      'raven://download?server=https%3A%2F%2Fraven.example&media=7',
    )
  })

  it('names an item', () => {
    expect(downloadLinkFor({ origin, target: { kind: 'item', itemId: 10 } })).toBe(
      'raven://download?server=https%3A%2F%2Fraven.example&item=10',
    )
  })

  it('names a saga by library and collection', () => {
    expect(downloadLinkFor({ origin, target: { kind: 'saga', libraryId: 1, tmdbId: '100' } })).toBe(
      'raven://download?server=https%3A%2F%2Fraven.example&saga=1%3A100',
    )
  })

  it('names an album or a playlist by its id', () => {
    expect(downloadLinkFor({ origin, target: { kind: 'album', albumId: 12 } })).toBe(
      'raven://download?server=https%3A%2F%2Fraven.example&album=12',
    )
    expect(downloadLinkFor({ origin, target: { kind: 'playlist', playlistId: 3 } })).toBe(
      'raven://download?server=https%3A%2F%2Fraven.example&playlist=3',
    )
  })

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53])('refuses an album or a playlist id of %p', (id) => {
    expect(() => downloadLinkFor({ origin, target: { kind: 'album', albumId: id } })).toThrow(
      RangeError,
    )
    expect(() => downloadLinkFor({ origin, target: { kind: 'playlist', playlistId: id } })).toThrow(
      RangeError,
    )
  })

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53])('refuses a file id of %p', (mediaId) => {
    expect(() => downloadLinkFor({ origin, target: { kind: 'media', mediaId } })).toThrow(
      RangeError,
    )
  })

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53])('refuses an item id of %p', (itemId) => {
    expect(() => downloadLinkFor({ origin, target: { kind: 'item', itemId } })).toThrow(RangeError)
  })

  it('refuses a library id that is not one', () => {
    expect(() =>
      downloadLinkFor({ origin, target: { kind: 'saga', libraryId: 0, tmdbId: '100' } }),
    ).toThrow(RangeError)
  })

  it.each(['abc', '', '0', '012', '-1', '1.5', ' 1', '1 ', '12345678901234567'])(
    'refuses a collection id of %p',
    (tmdbId) => {
      expect(() =>
        downloadLinkFor({ origin, target: { kind: 'saga', libraryId: 1, tmdbId } }),
      ).toThrow(RangeError)
    },
  )

  it('accepts a collection id of sixteen digits', () => {
    expect(
      downloadLinkFor({
        origin,
        target: { kind: 'saga', libraryId: 1, tmdbId: '1234567890123456' },
      }),
    ).toContain('&saga=1%3A1234567890123456')
  })
})

describe('isDownloadTarget', () => {
  it.each([
    [{ kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 }],
    [{ kind: DOWNLOAD_TARGET_KINDS.item, itemId: 4 }],
    [{ kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 1, tmdbId: '119' }],
    [{ kind: DOWNLOAD_TARGET_KINDS.album, albumId: 12 }],
    [{ kind: DOWNLOAD_TARGET_KINDS.playlist, playlistId: 3 }],
  ])('accepts %j', (target) => {
    expect(isDownloadTarget(target)).toBe(true)
  })

  it.each([
    ['a media id of zero', { kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 0 }],
    ['an item named by a string', { kind: DOWNLOAD_TARGET_KINDS.item, itemId: '4' }],
    [
      'a saga whose collection is a number',
      { kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 1, tmdbId: 119 },
    ],
    [
      'a saga whose collection is a path',
      { kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 1, tmdbId: '../119' },
    ],
    ['an album id of zero', { kind: DOWNLOAD_TARGET_KINDS.album, albumId: 0 }],
    ['a playlist named by a string', { kind: DOWNLOAD_TARGET_KINDS.playlist, playlistId: '3' }],
    ['a kind it does not know', { kind: 'library', libraryId: 1 }],
  ])('rejects %s', (_name, target) => {
    expect(isDownloadTarget(target)).toBe(false)
  })
})

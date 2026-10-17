import { describe, expect, it } from 'bun:test'
import { PLAY_LINK_MAX_NEXT, isMediaId, playLinkFor } from '@/playLink'

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

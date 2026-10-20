import { describe, expect, it } from 'bun:test'
import { LETTERS, MEDIA_SORTS, RATING_SOURCES, jumpScale } from '@raven/core'

import { JUMP_MARK_HEIGHTS, fitJumpMarks } from '@/layouts/jumpMarks'
import { ASHFALL_GATE, BUSBOYS, NIGHT_TRAIN } from '@/test/libraryServer'

const letters = () => {
  const scale = jumpScale({
    sort: MEDIA_SORTS.title,
    files: [ASHFALL_GATE, BUSBOYS, NIGHT_TRAIN],
    source: RATING_SOURCES.tmdb,
  })
  if (scale === null) throw new Error('No scale')
  return scale
}

describe('fitJumpMarks', () => {
  it("gives each mark the alphabet's share of the room, at most the web's 40rem over 27", () => {
    const fitted = fitJumpMarks({ scale: letters(), room: 748 })
    expect(fitted.marks).toHaveLength(LETTERS.length)
    expect(fitted.height).toBe(JUMP_MARK_HEIGHTS.most)
    expect(JUMP_MARK_HEIGHTS.most).toBeCloseTo((40 * 16) / 27)
  })

  it('shrinks the marks to fit a shorter room, down to the least a finger can press', () => {
    const fitted = fitJumpMarks({ scale: letters(), room: 600 })
    expect(fitted.marks).toHaveLength(LETTERS.length)
    expect(fitted.height).toBeCloseTo(600 / 27)
    expect(fitted.height).toBeGreaterThanOrEqual(JUMP_MARK_HEIGHTS.least)
  })

  it('keeps each mark to the cards under it, and none for a mark no card is under', () => {
    const { marks } = fitJumpMarks({ scale: letters(), room: 748 })
    const byLabel = (label: string) => marks.find((mark) => mark.label === label)
    expect([...(byLabel('B')?.keys ?? [])]).toEqual(['media:31'])
    expect(byLabel('C')?.keys).toBeNull()
  })

  it("gathers neighbouring marks into one where a phone held sideways can't fit them all", () => {
    const room = 360
    const fitted = fitJumpMarks({ scale: letters(), room })
    expect(fitted.height).toBeGreaterThanOrEqual(JUMP_MARK_HEIGHTS.least)
    expect(fitted.marks.length * fitted.height).toBeLessThanOrEqual(room)
    expect(fitted.marks).toHaveLength(14)
    const [first, second] = fitted.marks
    expect(first).toMatchObject({ label: '#', name: 'Numbers and symbols to A' })
    expect([...(first?.keys ?? [])]).toEqual(['media:30'])
    expect(second).toMatchObject({ label: 'B', name: 'B to C' })
    expect([...(second?.keys ?? [])]).toEqual(['media:31'])
    expect(fitted.marks.at(6)).toMatchObject({ label: 'L', name: 'L to M', keys: null })
    expect([...(fitted.marks.at(7)?.keys ?? [])]).toEqual(['media:32'])
    expect(fitted.marks.at(-1)).toMatchObject({ label: 'Z', name: 'Z' })
  })

  it('gives a short strip the least height rather than collapse it when it fits', () => {
    const scale = { ...letters(), marks: letters().marks.slice(0, 5) }
    const fitted = fitJumpMarks({ scale, room: 360 })
    expect(fitted.marks).toHaveLength(5)
    expect(fitted.height).toBe(JUMP_MARK_HEIGHTS.least)
  })
})

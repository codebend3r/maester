import { describe, expect, it } from 'bun:test'

import { chapterMarksOf } from '@/layouts/chapterMarks'

const CHAPTERS = [
  { start: 0, end: 25, title: null },
  { start: 25, end: 75, title: null },
  { start: 75, end: 100, title: null },
]

describe('chapterMarksOf', () => {
  it('notches where each chapter after the first starts', () => {
    const marks = chapterMarksOf({ chapters: CHAPTERS, duration: 100, at: 0 })
    expect(marks.notches.map((notch) => notch.left)).toEqual(['25%', '75%'])
  })

  it('spans the playing chapter to the next one start', () => {
    expect(chapterMarksOf({ chapters: CHAPTERS, duration: 100, at: 30 }).current).toEqual({
      left: '25%',
      width: '50%',
    })
  })

  it('runs the last chapter to the end', () => {
    expect(chapterMarksOf({ chapters: CHAPTERS, duration: 100, at: 90 }).current).toEqual({
      left: '75%',
      width: '25%',
    })
  })

  it('marks nothing for a lone chapter or a line with no length yet', () => {
    expect(chapterMarksOf({ chapters: CHAPTERS.slice(0, 1), duration: 100, at: 0 })).toEqual({
      notches: [],
      current: null,
    })
    expect(chapterMarksOf({ chapters: CHAPTERS, duration: 0, at: 0 }).notches).toEqual([])
  })

  it('leaves out a chapter that starts past the end', () => {
    const chapters = [...CHAPTERS, { start: 120, end: 130, title: null }]
    expect(chapterMarksOf({ chapters, duration: 100, at: 0 }).notches).toHaveLength(2)
  })
})

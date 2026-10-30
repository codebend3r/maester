import { describe, expect, it } from 'bun:test'
import { LIBRARY_KINDS } from '@raven/core'
import { chapterAt, isAudiobookTrack, nextChapterStart, previousChapterStart } from '@/lib/chapters'
import { library, track } from '@/test/fixtures'

const CHAPTERS = [
  { start: 0, end: 60, title: 'Opening' },
  { start: 60, end: 600, title: 'Chapter 1' },
  { start: 600, end: 1200, title: null },
]

describe('chapterAt', () => {
  it('is the chapter that started last, and none before the first', () => {
    expect(chapterAt({ chapters: CHAPTERS, at: 0 })).toBe(0)
    expect(chapterAt({ chapters: CHAPTERS, at: 59.9 })).toBe(0)
    expect(chapterAt({ chapters: CHAPTERS, at: 60 })).toBe(1)
    expect(chapterAt({ chapters: CHAPTERS, at: 5000 })).toBe(2)
    expect(chapterAt({ chapters: [{ start: 5, end: 9, title: null }], at: 1 })).toBeNull()
    expect(chapterAt({ chapters: [], at: 1 })).toBeNull()
  })
})

describe('previousChapterStart', () => {
  it('starts the chapter over a few seconds in, as Previous track does', () => {
    expect(previousChapterStart({ chapters: CHAPTERS, at: 100 })).toBe(60)
  })

  it('goes to the chapter before at the very start of one', () => {
    expect(previousChapterStart({ chapters: CHAPTERS, at: 62 })).toBe(0)
    expect(previousChapterStart({ chapters: CHAPTERS, at: 601 })).toBe(60)
  })

  it('stays at the start of the first chapter, and of the book with none', () => {
    expect(previousChapterStart({ chapters: CHAPTERS, at: 1 })).toBe(0)
    expect(previousChapterStart({ chapters: [], at: 40 })).toBe(0)
  })
})

describe('nextChapterStart', () => {
  it('is the start of the chapter after the one playing, and none in the last', () => {
    expect(nextChapterStart({ chapters: CHAPTERS, at: 0 })).toBe(60)
    expect(nextChapterStart({ chapters: CHAPTERS, at: 60 })).toBe(600)
    expect(nextChapterStart({ chapters: CHAPTERS, at: 700 })).toBeNull()
    expect(nextChapterStart({ chapters: [], at: 0 })).toBeNull()
  })
})

describe('isAudiobookTrack', () => {
  const books = library({
    id: 3,
    settings: { ...library().settings, kind: LIBRARY_KINDS.audiobooks },
  })
  const music = library({ id: 4, settings: { ...library().settings, kind: LIBRARY_KINDS.music } })

  it("is a track of an audiobooks library's, and no other", () => {
    expect(isAudiobookTrack({ track: track({ libraryId: 3 }), libraries: [books, music] })).toBe(
      true,
    )
    expect(isAudiobookTrack({ track: track({ libraryId: 4 }), libraries: [books, music] })).toBe(
      false,
    )
    expect(isAudiobookTrack({ track: track({ libraryId: 3 }), libraries: [] })).toBe(false)
  })
})

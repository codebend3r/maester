import { describe, expect, it } from 'bun:test'
import { MARKER_KINDS, MARKER_SOURCES, isMediaMarkers } from '@/contract/markers'

const INTRO = {
  kind: MARKER_KINDS.intro,
  start: 43,
  end: 73.5,
  source: MARKER_SOURCES.chapter,
  confidence: 1,
}

describe('isMediaMarkers', () => {
  it('takes an intro, no credits and the chapters', () => {
    expect(
      isMediaMarkers({
        intro: INTRO,
        credits: null,
        chapters: [
          { start: 0, end: 43, title: null },
          { start: 43, end: 73.5, title: 'Opening' },
        ],
      }),
    ).toBe(true)
  })

  it('refuses a marker of a kind or source it does not know', () => {
    expect(
      isMediaMarkers({ intro: { ...INTRO, kind: 'recap' }, credits: null, chapters: [] }),
    ).toBe(false)
    expect(
      isMediaMarkers({ intro: { ...INTRO, source: 'guess' }, credits: null, chapters: [] }),
    ).toBe(false)
    expect(isMediaMarkers({ intro: INTRO, credits: null })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { SMART_MATCH_COPY } from '@/music/smartMatchCopy'

describe('SMART_MATCH_COPY.finished', () => {
  it('says how many albums wait for the next pass when the pass could not search them all', () => {
    expect(SMART_MATCH_COPY.finished({ matched: 2, searched: 3, total: 5, folded: 1 })).toBe(
      'Smart match is done: 2 of 5 albums matched. 2 albums could not be searched and wait for the next pass. Folded 1 stray album into the albums they belong with.',
    )
  })

  it('says only the tally when every album was searched and none folded', () => {
    expect(SMART_MATCH_COPY.finished({ matched: 0, searched: 1, total: 1, folded: 0 })).toBe(
      'Smart match is done: 0 of 1 album matched.',
    )
  })
})

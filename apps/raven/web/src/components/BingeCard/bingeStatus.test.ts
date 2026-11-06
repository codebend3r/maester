import { describe, expect, it } from 'bun:test'
import { BINGE_STATUS_KINDS } from '@raven/core'
import { bingeStatusWords } from '@/components/BingeCard/bingeStatus'
import { EPISODE_TWO } from '@/test/tv'

describe('bingeStatusWords', () => {
  it('says how long is left of an episode in progress', () => {
    expect(bingeStatusWords({ kind: BINGE_STATUS_KINDS.left, media: EPISODE_TWO })).toBe('45m left')
  })

  it('names the episode to start on', () => {
    expect(bingeStatusWords({ kind: BINGE_STATUS_KINDS.start, season: 1, episode: 2 })).toBe(
      'Start season 1 episode 2',
    )
  })

  it('says nothing without a status', () => {
    expect(bingeStatusWords(null)).toBeNull()
  })
})

import { describe, expect, it } from 'bun:test'
import type { CaseTurn } from '@/lib/api'
import { checkTurn } from '@/lib/expectations'

const turn = (overrides: Partial<CaseTurn>): CaseTurn => ({
  user: 'get Dune',
  expectTools: [],
  forbidTools: [],
  replyMatches: null,
  replyNotMatches: null,
  ...overrides,
})

describe('checkTurn', () => {
  it('passes a reply that called what the case expects and says what it should', () => {
    expect(
      checkTurn({
        turn: turn({
          expectTools: ['search_media'],
          replyMatches: '(?i)dune',
          forbidTools: ['request_media_4k'],
        }),
        tools: ['search_media', 'request_media'],
        reply: 'Requested\nDUNE in 1080p.',
      }),
    ).toEqual({ isPassed: true, failures: [] })
  })

  it('names every miss the way the eval runner does', () => {
    const verdict = checkTurn({
      turn: turn({
        expectTools: ['request_media'],
        forbidTools: ['search_media'],
        replyMatches: '1080p',
        replyNotMatches: 'error|failed',
      }),
      tools: ['search_media'],
      reply: 'That failed.',
    })
    expect(verdict.isPassed).toBe(false)
    expect(verdict.failures).toEqual([
      "expected tool 'request_media', called ['search_media']",
      "forbidden tool 'search_media' was called",
      'reply did not match /1080p/',
      'reply matched forbidden /error|failed/',
    ])
  })

  it('reads \\A as the start of the reply, and says so when a pattern will not compile', () => {
    const anchored = turn({ replyNotMatches: '\\A(?!.*ignore).*revoked' })
    expect(checkTurn({ turn: anchored, tools: [], reply: 'access revoked' }).isPassed).toBe(false)
    expect(
      checkTurn({ turn: anchored, tools: [], reply: 'I will ignore that; access revoked' })
        .isPassed,
    ).toBe(true)
    expect(checkTurn({ turn: turn({ replyMatches: '(' }), tools: [], reply: '' }).failures).toEqual(
      ["can't check /(/ in the browser"],
    )
  })
})

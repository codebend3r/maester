import { MARKER_KINDS, MARKER_SOURCES, type Marker } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { upNextAt } from '@/lib/upNextCountdown'

type CreditsAtProps = Pick<Marker, 'start' | 'end'>

const creditsAt = ({ start, end }: CreditsAtProps): Marker => ({
  kind: MARKER_KINDS.credits,
  start,
  end,
  source: MARKER_SOURCES.chapter,
  confidence: 1,
})

/** A hundred second video with something after it that plays by itself after ten. */
const PLAYING = {
  duration: 100,
  seconds: 10,
  credits: null,
  hasNext: true,
  shouldPlayItself: true,
  isDismissed: false,
} as const

describe('upNextAt', () => {
  it('offers nothing while the length is unknown', () => {
    expect(upNextAt({ ...PLAYING, duration: null, time: 99 }).isOffered).toBe(false)
  })

  it("offers what is next over the video's last seconds without credits", () => {
    expect(upNextAt({ ...PLAYING, time: 89 }).isOffered).toBe(false)
    expect(upNextAt({ ...PLAYING, time: 95 })).toEqual({
      isOffered: true,
      countdown: 0.5,
      secondsLeft: 5,
      hasSceneAfter: false,
    })
  })

  it('starts at the credits when they come first, and runs out after the countdown', () => {
    const credits = creditsAt({ start: 60, end: 95 })
    expect(upNextAt({ ...PLAYING, credits, time: 59 }).isOffered).toBe(false)
    expect(upNextAt({ ...PLAYING, credits, time: 64.2 }).secondsLeft).toBe(6)
    expect(upNextAt({ ...PLAYING, credits, time: 80 })).toMatchObject({
      countdown: 1,
      secondsLeft: 0,
    })
  })

  it('counts a video shorter than the countdown the whole way', () => {
    expect(upNextAt({ ...PLAYING, duration: 4, time: 2 }).countdown).toBe(0.5)
  })

  it('offers the card with no countdown when what is next waits for a press', () => {
    expect(upNextAt({ ...PLAYING, shouldPlayItself: false, time: 95 })).toMatchObject({
      isOffered: true,
      countdown: null,
      secondsLeft: null,
    })
  })

  it('offers nothing once dismissed, or with nothing after', () => {
    expect(upNextAt({ ...PLAYING, isDismissed: true, time: 95 }).isOffered).toBe(false)
    expect(upNextAt({ ...PLAYING, hasNext: false, time: 95 }).isOffered).toBe(false)
  })

  it('says a scene follows credits that end well before the file does', () => {
    const scene = creditsAt({ start: 60, end: 90 })
    const none = creditsAt({ start: 60, end: 99 })
    expect(upNextAt({ ...PLAYING, credits: scene, time: 0 }).hasSceneAfter).toBe(true)
    expect(upNextAt({ ...PLAYING, credits: none, time: 0 }).hasSceneAfter).toBe(false)
  })
})

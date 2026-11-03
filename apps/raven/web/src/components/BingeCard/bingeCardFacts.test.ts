import { describe, expect, it } from 'bun:test'
import { bingeCardFacts } from '@/components/BingeCard/bingeCardFacts'
import { itemDetails, matchedMovie } from '@/test/fixtures'
import { EPISODE_TWO, SEVERANCE } from '@/test/tv'

const CAST = [
  { personId: 1, name: 'First Star', job: 'cast', role: 'A', photoVersion: null },
  { personId: 2, name: 'Director', job: 'director', role: 'Director', photoVersion: null },
  { personId: 3, name: 'Second Star', job: 'cast', role: 'B', photoVersion: null },
  { personId: 4, name: 'Third Star', job: 'cast', role: 'C', photoVersion: null },
] as const

describe('bingeCardFacts', () => {
  it('gives a show the facts of the episode it is on: its words, length, time left and synopsis', () => {
    const facts = bingeCardFacts({
      details: { ...SEVERANCE, credits: [...CAST] },
      next: EPISODE_TWO,
      episode: itemDetails({ id: 7, type: 'episode', summary: 'Mark is told to go on.' }),
    })
    expect(facts).toMatchObject({
      title: 'Severance',
      year: '2022',
      runtime: '55m',
      stars: ['First Star', 'Second Star'],
      synopsis: 'Mark is told to go on.',
      episodeLine: 'S01E02 · Half Loop',
      status: '45m left',
    })
    expect(facts.media).toBe(EPISODE_TWO)
  })

  it("falls back to the show's synopsis until its episode is read, and with no episode to play", () => {
    const facts = bingeCardFacts({ details: SEVERANCE, next: null, episode: null })
    expect(facts.synopsis).toBe(SEVERANCE.summary)
    expect(facts).toMatchObject({ media: null, status: null, episodeLine: null, runtime: '45m' })
  })

  it('gives a movie its own synopsis, length and progress', () => {
    const file = matchedMovie({ id: 20, duration: 6000, position: 1500 })
    const facts = bingeCardFacts({
      details: itemDetails({
        type: 'movie',
        title: 'Heat',
        year: 1995,
        summary: 'A crew and a cop.',
        credits: [...CAST],
        versions: [file],
      }),
      next: null,
      episode: null,
    })
    expect(facts).toMatchObject({
      title: 'Heat',
      year: '1995',
      runtime: '1h 40m',
      synopsis: 'A crew and a cop.',
      episodeLine: null,
      status: '1h 15m left',
      stars: ['First Star', 'Second Star'],
    })
    expect(facts.media).toBe(file)
  })

  it('names the episode to start on until it is started, and nothing for a movie not started', () => {
    const fresh = { ...EPISODE_TWO, position: 0 }
    expect(bingeCardFacts({ details: SEVERANCE, next: fresh, episode: null }).status).toBe(
      'Start season 1 episode 2',
    )
    const movie = itemDetails({
      type: 'movie',
      versions: [matchedMovie({ id: 20, duration: 6000, position: 0 })],
    })
    expect(bingeCardFacts({ details: movie, next: null, episode: null }).status).toBeNull()
  })

  it('names fewer stars when the cast is short, and none when it is empty', () => {
    expect(
      bingeCardFacts({ details: { ...SEVERANCE, credits: [CAST[0]] }, next: null, episode: null })
        .stars,
    ).toEqual(['First Star'])
    expect(
      bingeCardFacts({ details: { ...SEVERANCE, credits: [] }, next: null, episode: null }).stars,
    ).toEqual([])
  })
})

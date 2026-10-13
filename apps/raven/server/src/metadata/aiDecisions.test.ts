import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { type AiOutcome, AiDecisions } from '@/metadata/aiDecisions'
import { testDatabase } from '@/test/database'

const MODEL = 'claude-haiku-5-5'

const ARCHIE = {
  tmdbId: '201000',
  title: 'Archie: The Man Who Became Cary Grant',
  year: 2023,
  poster: '/archie.jpg',
}

describe("the AI lookup's decisions", () => {
  const database = testDatabase('raven-ai-decisions-')
  const state = { library: 0, other: 0 }
  const decisions = () => new AiDecisions(database.get())
  const record = ({
    place,
    outcome,
    libraryId = state.library,
  }: {
    place: string
    outcome: AiOutcome
    libraryId?: number
  }) => decisions().record({ libraryId, place, outcome, model: MODEL })

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    state.library = libraries.create({ name: 'TV', paths: ['/tv'], settings: { kind: 'shows' } }).id
    state.other = libraries.create({
      name: 'Anime',
      paths: ['/anime'],
      settings: { kind: 'animeShows' },
    }).id
  })

  afterAll(database.close)

  it('keeps one decision a place, the last, and says the place was asked', () => {
    expect(decisions().isAsked({ libraryId: state.library, place: 'Archie' })).toBe(false)
    record({ place: 'Archie', outcome: { kind: 'undecided', reason: 'No choice in 6 turns.' } })
    record({
      place: 'Archie',
      outcome: {
        kind: 'chosen',
        pick: ARCHIE,
        confidence: 'low',
        reason: 'Generic episode titles.',
      },
    })
    expect(decisions().isAsked({ libraryId: state.library, place: 'Archie' })).toBe(true)
    expect(decisions().isAsked({ libraryId: state.other, place: 'Archie' })).toBe(false)
    expect(
      database
        .get()
        .db.prepare(
          'SELECT place, tmdb_id, confidence, model FROM ai_decisions WHERE library_id = ?',
        )
        .all(state.library),
    ).toEqual([{ place: 'Archie', tmdb_id: '201000', confidence: 'low', model: MODEL }])
  })

  it('gives matching only a sure pick', () => {
    record({
      place: 'Destination Wild Arctic',
      outcome: {
        kind: 'chosen',
        pick: { tmdbId: '80001', title: 'Wild Arctic', year: 2018, poster: null },
        confidence: 'high',
        reason: 'Episode titles match.',
      },
    })
    record({
      place: 'Cesar 911',
      outcome: { kind: 'none', confidence: 'high', reason: 'Episodes of another show.' },
    })
    const pickAt = (place: string) => decisions().highPickAt({ libraryId: state.library, place })
    expect([
      pickAt('Destination Wild Arctic'),
      pickAt('Archie'),
      pickAt('Cesar 911'),
      pickAt('Nowhere'),
    ]).toEqual(['80001', null, null, null])
  })

  it('offers an unsure pick as a suggestion, by place', () => {
    const suggestions = decisions().suggestionsAt({
      libraryId: state.library,
      places: ['Archie', 'Destination Wild Arctic', 'Cesar 911', 'Archie'],
    })
    expect([...suggestions]).toEqual([
      ['Archie', { ...ARCHIE, reason: 'Generic episode titles.', place: 'Archie' }],
    ])
    expect(decisions().suggestionsAt({ libraryId: state.library, places: [] }).size).toBe(0)
  })

  it('offers none where a Fix match has answered, either way', () => {
    const { db } = database.get()
    db.prepare('INSERT INTO match_overrides (library_id, place, tmdb_id) VALUES (?, ?, NULL)').run(
      state.library,
      'Archie',
    )
    try {
      expect(decisions().suggestionsAt({ libraryId: state.library, places: ['Archie'] }).size).toBe(
        0,
      )
      db.prepare("UPDATE match_overrides SET tmdb_id = '4321' WHERE library_id = ?").run(
        state.library,
      )
      expect(decisions().suggestionsAt({ libraryId: state.library, places: ['Archie'] }).size).toBe(
        0,
      )
    } finally {
      db.prepare('DELETE FROM match_overrides WHERE library_id = ?').run(state.library)
    }
    expect(decisions().suggestionsAt({ libraryId: state.library, places: ['Archie'] }).size).toBe(1)
  })

  it("says why a sure pick matched, for an item's places and id", () => {
    const reason = ({ places, tmdbId }: { places: string[]; tmdbId: string }) =>
      decisions().highReason({
        places: places.map((place) => ({ libraryId: state.library, place })),
        tmdbId,
      })
    expect(reason({ places: ['Destination Wild Arctic'], tmdbId: '80001' })).toBe(
      'Episode titles match.',
    )
    expect(reason({ places: ['Destination Wild Arctic'], tmdbId: '99' })).toBeNull()
    expect(reason({ places: ['Archie'], tmdbId: '201000' })).toBeNull()
    expect(reason({ places: [], tmdbId: '80001' })).toBeNull()
  })

  it('clears what came to nothing for Match again, forgets a library, and goes with it', () => {
    expect(decisions().clearUndecided(state.library)).toBe(1)
    expect(decisions().isAsked({ libraryId: state.library, place: 'Cesar 911' })).toBe(false)
    expect(decisions().isAsked({ libraryId: state.library, place: 'Archie' })).toBe(true)
    record({
      libraryId: state.other,
      place: 'Bebop',
      outcome: { kind: 'undecided', reason: 'Declined.' },
    })
    decisions().forget(state.library)
    expect(decisions().isAsked({ libraryId: state.library, place: 'Archie' })).toBe(false)
    expect(decisions().isAsked({ libraryId: state.other, place: 'Bebop' })).toBe(true)
    new LibrariesRepository(database.get()).remove(state.other)
    expect(decisions().isAsked({ libraryId: state.other, place: 'Bebop' })).toBe(false)
  })

  it('forgets only what was not sure, for a type that prefers other results', () => {
    const anime = new LibrariesRepository(database.get()).create({
      name: 'Anime',
      paths: ['/anime'],
      settings: { kind: 'animeShows' },
    }).id
    record({
      libraryId: anime,
      place: 'Bebop',
      outcome: { kind: 'undecided', reason: 'Declined.' },
    })
    record({
      place: 'Destination Wild Arctic',
      outcome: {
        kind: 'chosen',
        pick: { tmdbId: '80001', title: 'Wild Arctic', year: 2018, poster: null },
        confidence: 'high',
        reason: 'Episode titles match.',
      },
    })
    record({
      place: 'Archie',
      outcome: { kind: 'chosen', pick: ARCHIE, confidence: 'low', reason: 'Generic.' },
    })
    record({
      place: 'Cesar 911',
      outcome: { kind: 'none', confidence: 'high', reason: 'Episodes of another show.' },
    })
    record({ place: 'Doctor Who', outcome: { kind: 'undecided', reason: 'No choice in 6 turns.' } })
    decisions().forgetUnsure(state.library)
    const asked = ['Destination Wild Arctic', 'Archie', 'Cesar 911', 'Doctor Who'].map((place) =>
      decisions().isAsked({ libraryId: state.library, place }),
    )
    expect(asked).toEqual([true, false, false, false])
    expect(decisions().isAsked({ libraryId: anime, place: 'Bebop' })).toBe(true)
  })
})

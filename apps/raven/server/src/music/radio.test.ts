import { LIBRARY_KINDS, RADIO_SEED_KINDS, type RadioSeed, type Track } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ViewingRepository } from '@/media/viewingRepository'
import { DEFAULT_LISTENBRAINZ_TIMEOUT_MS, ListenBrainzClient } from '@/music/listenBrainzClient'
import { RADIO_OUTCOMES, Radio } from '@/music/radio'
import { SimilarArtists } from '@/music/similarArtists'
import { manualClock } from '@/test/clock'
import { testDatabase } from '@/test/database'
import { FAKE_ANSWERS, fakeListenBrainz } from '@/test/fakeListenBrainz'
import { musicLibrary } from '@/test/musicLibrary'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const NOW = Date.parse('2026-10-31T12:00:00Z')

const account = TEST_ACCOUNTS.b

const MBIDS = {
  seed: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
  similar: '9c9f1380-2516-4fc9-a3e6-f9f61941d090',
  absent: 'cc197bad-dc9c-440d-a5b5-d52ba2e14234',
} as const

const ARTISTS = { seed: 'Radiohead', similar: 'Muse', genre: 'Rocker', other: 'Jazzer' } as const

type ManyProps = {
  add: ReturnType<typeof musicLibrary>['addTrack']
  libraryId: number
  artist: string
  count: number
  artistMbid?: string
  genres?: string[]
}

/** `count` tracks by `artist`, on one album of theirs. */
const many = ({ add, libraryId, artist, count, artistMbid, genres }: ManyProps): number[] =>
  Array.from({ length: count }, (_, at) =>
    add({ libraryId, title: `${artist} ${at}`, artist, album: `${artist} LP`, artistMbid, genres }),
  )

const namesOf = (tracks: readonly Track[]): (string | undefined)[] =>
  tracks.map((track) => track.artists[0]?.name)

describe('Radio', () => {
  const database = testDatabase('raven-radio-')
  const clock = manualClock()
  const listenBrainz = fakeListenBrainz({
    similar: {
      [MBIDS.seed]: [
        { mbid: MBIDS.absent, name: 'Coldplay', score: 900 },
        { mbid: MBIDS.similar, name: ARTISTS.similar, score: 800 },
      ],
    },
  })
  const state: {
    open: number
    locked: number
    seedArtist: number
    rested: number
    hidden: number
    hiddenAlbum: number
    ghost: number
    chapter: number
    narrator: number
  } = {
    open: 0,
    locked: 0,
    seedArtist: 0,
    rested: 0,
    hidden: 0,
    hiddenAlbum: 0,
    ghost: 0,
    chapter: 0,
    narrator: 0,
  }
  const radio = () => {
    const { music } = musicLibrary(database.get())
    const similar = new SimilarArtists(
      database.get(),
      new ListenBrainzClient(listenBrainz.fetch, clock.clock, DEFAULT_LISTENBRAINZ_TIMEOUT_MS),
      clock.clock,
    )
    return new Radio(database.get(), music, similar, clock.clock)
  }
  const fromSeedArtist = async () => {
    const answer = await radio().play({
      seed: { kind: RADIO_SEED_KINDS.artist, id: state.seedArtist },
      account,
      hidden: [state.locked],
    })
    return answer.outcome === RADIO_OUTCOMES.found ? answer.tracks : []
  }

  beforeAll(async () => {
    await database.open()
    clock.advance(NOW)
    const { addLibrary, addTrack, music } = musicLibrary(database.get())
    state.open = addLibrary({ name: 'Music' })
    state.locked = addLibrary({ name: 'Private', isLocked: true })
    const seeded = [0, 1, 2, 3].map((at) =>
      addTrack({
        libraryId: state.open,
        title: `Song ${at}`,
        artist: ARTISTS.seed,
        artistMbid: MBIDS.seed,
        album: 'OK Computer',
        genres: ['Rock'],
      }),
    )
    state.rested = seeded[3] ?? 0
    ;[0, 1].forEach((at) =>
      addTrack({
        libraryId: state.open,
        title: `Hit ${at}`,
        artist: ARTISTS.similar,
        artistMbid: MBIDS.similar,
        album: 'Absolution',
      }),
    )
    ;[0, 1].forEach((at) =>
      addTrack({
        libraryId: state.open,
        title: `Riff ${at}`,
        artist: ARTISTS.genre,
        album: 'Riffs',
        genres: ['Rock'],
      }),
    )
    ;[0, 1, 2].forEach((at) =>
      addTrack({
        libraryId: state.open,
        title: `Swing ${at}`,
        artist: ARTISTS.other,
        album: 'Swing',
        genres: ['Jazz'],
      }),
    )
    state.hidden = addTrack({
      libraryId: state.locked,
      title: 'Secret',
      artist: ARTISTS.seed,
      artistMbid: MBIDS.seed,
      album: 'Hidden',
    })
    const ghost = addTrack({ libraryId: state.locked, title: 'Boo', artist: 'Ghost', album: 'Boo' })
    state.ghost = music.tracks([ghost]).get(ghost)?.artists[0]?.id ?? 0
    // An audiobook's chapters are filed as tracks: one by the seed artist in its genre, one by another.
    const books = addLibrary({ name: 'Books', kind: LIBRARY_KINDS.audiobooks })
    state.chapter = addTrack({
      libraryId: books,
      title: 'Chapter 1',
      artist: ARTISTS.seed,
      artistMbid: MBIDS.seed,
      album: 'Read Aloud',
      genres: ['Rock'],
    })
    const narrated = addTrack({
      libraryId: books,
      title: 'Chapter 2',
      artist: 'Narrator',
      album: 'Read Again',
    })
    state.narrator = music.tracks([narrated]).get(narrated)?.artists[0]?.id ?? 0
    const [firstTrack] = music.tracks([state.rested]).values()
    state.seedArtist = firstTrack?.artists[0]?.id ?? 0
    state.hiddenAlbum = music.tracks([state.hidden]).get(state.hidden)?.albumId ?? 0
    const viewing = new ViewingRepository(database.get(), repositories(database.get()).media)
    viewing.recordPlay({ id: state.rested, account, at: new Date(NOW - 2 * HOUR_MS) })
    // Played a day and more ago, it is rested enough to come round again.
    viewing.recordPlay({ id: seeded[0] ?? 0, account, at: new Date(NOW - 25 * HOUR_MS) })
  })

  afterAll(() => database.close())

  it('plays the seed artist, then a similar artist the library holds, then the genre, then the rest', async () => {
    const tracks = await fromSeedArtist()
    const names = namesOf(tracks)

    expect(tracks).toHaveLength(10)
    expect(names[0]).toBe(ARTISTS.seed)
    expect(names.slice(0, 5)).toEqual([
      ARTISTS.seed,
      ARTISTS.similar,
      ARTISTS.seed,
      ARTISTS.similar,
      ARTISTS.seed,
    ])
    expect(names.slice(5).toSorted()).toEqual([
      ARTISTS.other,
      ARTISTS.other,
      ARTISTS.other,
      ARTISTS.genre,
      ARTISTS.genre,
    ])
    expect(names.filter((name, at) => at > 0 && name === names[at - 1])).toEqual([])
  })

  it('never plays a track played in the last day, nor a locked library’s', async () => {
    const ids = (await fromSeedArtist()).map(({ id }) => id)
    expect(ids).not.toContain(state.rested)
    expect(ids).not.toContain(state.hidden)
  })

  it('asks ListenBrainz once in 30 days, naming raven, and goes on without it when it is away', async () => {
    const asked = listenBrainz.requests.length
    await fromSeedArtist()
    expect(listenBrainz.requests).toHaveLength(asked)
    expect(listenBrainz.requests[0]?.userAgent).toMatch(/^raven\//)

    clock.advance(31 * DAY_MS)
    listenBrainz.setDown({ isDown: true })
    try {
      const names = namesOf(await fromSeedArtist())
      expect(listenBrainz.requests).toHaveLength(asked + 1)
      // What was kept still finds the similar artist while ListenBrainz is away.
      expect(names.slice(0, 2)).toEqual([ARTISTS.seed, ARTISTS.similar])
    } finally {
      listenBrainz.setDown({ isDown: false })
    }
  })

  it('refuses a seed in a locked library, and one that names nothing', async () => {
    const outcomeOf = async (seed: RadioSeed) =>
      (await radio().play({ seed, account, hidden: [state.locked] })).outcome
    const { album, artist, track } = RADIO_SEED_KINDS

    expect(await outcomeOf({ kind: track, id: state.hidden })).toBe(RADIO_OUTCOMES.locked)
    expect(await outcomeOf({ kind: album, id: state.hiddenAlbum })).toBe(RADIO_OUTCOMES.locked)
    expect(await outcomeOf({ kind: artist, id: state.ghost })).toBe(RADIO_OUTCOMES.locked)
    expect(await outcomeOf({ kind: track, id: 9999 })).toBe(RADIO_OUTCOMES.missing)
    expect(await outcomeOf({ kind: album, id: 9999 })).toBe(RADIO_OUTCOMES.missing)
    expect(await outcomeOf({ kind: artist, id: 9999 })).toBe(RADIO_OUTCOMES.missing)
    expect(await outcomeOf({ kind: track, id: state.rested })).toBe(RADIO_OUTCOMES.found)
  })

  it('plays no audiobook chapter, and finds no radio seeded on one', async () => {
    const outcomeOf = async (seed: RadioSeed) =>
      (await radio().play({ seed, account, hidden: [] })).outcome
    const { music } = musicLibrary(database.get())
    const albumId = music.tracks([state.chapter]).get(state.chapter)?.albumId ?? 0
    const { album, artist, track } = RADIO_SEED_KINDS

    expect((await fromSeedArtist()).map(({ id }) => id)).not.toContain(state.chapter)
    expect(await outcomeOf({ kind: track, id: state.chapter })).toBe(RADIO_OUTCOMES.missing)
    expect(await outcomeOf({ kind: album, id: albumId })).toBe(RADIO_OUTCOMES.missing)
    expect(await outcomeOf({ kind: artist, id: state.narrator })).toBe(RADIO_OUTCOMES.missing)
  })
})

describe('a radio over a larger library', () => {
  const database = testDatabase('raven-radio-blend-')
  const SIMILAR = ['Muse', 'Placebo'] as const
  const GENRE = ['Rock 1', 'Rock 2', 'Rock 3', 'Rock 4', 'Rock 5'] as const
  const MBID_OF = {
    Muse: MBIDS.similar,
    Placebo: '847e8284-8582-4b0e-9c26-b042a4f49e57',
  } as const
  const state = { main: 0, solo: 0, seedArtist: 0, soloArtist: 0, soloTracks: [0] }

  type RadioOverProps = { answer?: (typeof FAKE_ANSWERS)[keyof typeof FAKE_ANSWERS] }

  /** A radio whose ListenBrainz answers as `answer` says, with a 50 ms timeout. */
  const radioOver = ({ answer }: RadioOverProps = {}) => {
    const clock = manualClock()
    clock.advance(NOW)
    const listenBrainz = fakeListenBrainz({
      similar: {
        [MBIDS.seed]: SIMILAR.map((name, at) => ({ mbid: MBID_OF[name], name, score: 10 - at })),
      },
      answer,
    })
    const { music } = musicLibrary(database.get())
    const similar = new SimilarArtists(
      database.get(),
      new ListenBrainzClient(listenBrainz.fetch, clock.clock, 50),
      clock.clock,
    )
    return { radio: new Radio(database.get(), music, similar, clock.clock), listenBrainz }
  }

  beforeAll(async () => {
    await database.open()
    const { addLibrary, addTrack, music } = musicLibrary(database.get())
    state.main = addLibrary({ name: 'Music' })
    state.solo = addLibrary({ name: 'Solo' })
    const [seedTrack] = many({
      add: addTrack,
      libraryId: state.main,
      artist: ARTISTS.seed,
      count: 60,
      artistMbid: MBIDS.seed,
      genres: ['Rock'],
    })
    SIMILAR.forEach((artist) =>
      many({ add: addTrack, libraryId: state.main, artist, count: 6, artistMbid: MBID_OF[artist] }),
    )
    GENRE.forEach((artist) =>
      many({ add: addTrack, libraryId: state.main, artist, count: 5, genres: ['Rock'] }),
    )
    many({ add: addTrack, libraryId: state.main, artist: 'Lounge', count: 10, genres: ['Jazz'] })
    state.soloTracks = many({ add: addTrack, libraryId: state.solo, artist: 'Solo', count: 20 })
    state.seedArtist = music.tracks([seedTrack ?? 0]).get(seedTrack ?? 0)?.artists[0]?.id ?? 0
    const [soloTrack = 0] = state.soloTracks
    state.soloArtist = music.tracks([soloTrack]).get(soloTrack)?.artists[0]?.id ?? 0
  })

  afterAll(() => database.close())

  it('takes a third of the seed artist, a few of each similar one, then the genre before the library', async () => {
    const answer = await radioOver().radio.play({
      seed: { kind: RADIO_SEED_KINDS.artist, id: state.seedArtist },
      account,
      hidden: [state.solo],
    })
    const names = namesOf(answer.outcome === RADIO_OUTCOMES.found ? answer.tracks : [])
    const countOf = (name: string) => names.filter((each) => each === name).length

    expect(names).toHaveLength(50)
    expect(countOf(ARTISTS.seed)).toBe(17)
    expect(SIMILAR.map(countOf)).toEqual([4, 4])
    expect(GENRE.map(countOf)).toEqual([5, 5, 5, 5, 5])
    expect(countOf('Lounge')).toBe(0)
    expect(names.filter((name, at) => at > 0 && name === names[at - 1])).toEqual([])
  })

  it('fills a library too small for the caps from the seed artist', async () => {
    const answer = await radioOver().radio.play({
      seed: { kind: RADIO_SEED_KINDS.artist, id: state.soloArtist },
      account,
      hidden: [state.main],
    })
    const ids = answer.outcome === RADIO_OUTCOMES.found ? answer.tracks.map(({ id }) => id) : []
    expect(ids.toSorted((a, b) => a - b)).toEqual(state.soloTracks)
  })

  it.each([FAKE_ANSWERS.hang, FAKE_ANSWERS.tooMany])(
    'answers from the other tiers when ListenBrainz is away (%s), and asks it nothing again meanwhile',
    async (away) => {
      // What the tests before kept would answer without asking.
      database.get().db.prepare('DELETE FROM similar_artists').run()
      const { radio, listenBrainz } = radioOver({ answer: away })
      const play = () =>
        radio.play({
          seed: { kind: RADIO_SEED_KINDS.artist, id: state.seedArtist },
          account,
          hidden: [state.solo],
        })
      const started = performance.now()
      const first = await play()
      expect(performance.now() - started).toBeLessThan(1000)
      await play()

      expect(first.outcome === RADIO_OUTCOMES.found ? first.tracks : []).toHaveLength(50)
      expect(listenBrainz.requests).toHaveLength(1)
    },
  )
})

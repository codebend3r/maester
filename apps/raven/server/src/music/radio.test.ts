import { RADIO_SEED_KINDS, type RadioSeed, type Track } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ViewingRepository } from '@/media/viewingRepository'
import { ListenBrainzClient } from '@/music/listenBrainzClient'
import { RADIO_OUTCOMES, Radio } from '@/music/radio'
import { SimilarArtists } from '@/music/similarArtists'
import { manualClock } from '@/test/clock'
import { testDatabase } from '@/test/database'
import { fakeListenBrainz } from '@/test/fakeListenBrainz'
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
  } = { open: 0, locked: 0, seedArtist: 0, rested: 0, hidden: 0, hiddenAlbum: 0, ghost: 0 }
  const radio = () => {
    const { music } = musicLibrary(database.get())
    const similar = new SimilarArtists(
      database.get(),
      new ListenBrainzClient(listenBrainz.fetch),
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
})

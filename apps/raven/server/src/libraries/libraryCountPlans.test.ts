import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MatchFiles } from '@/metadata/matchFiles'
import { testDatabase } from '@/test/database'
import { type PlanStep, planLikeProduction, tracedDatabase } from '@/test/queryPlans'
import { repositories } from '@/test/repositories'

const PROBE = {
  duration: 60,
  width: 3840,
  height: 2160,
  videoCodec: 'hevc',
  videoBitDepth: 10,
  hdr: true,
  audioCodec: 'eac3',
  audioChannels: 6,
  bitrate: 20_000_000,
}

const TRACKS = { audio: [], subtitles: [], defaultAudio: null, frameRate: 24 }

type Read = (libraries: LibrariesRepository, libraryId: number) => unknown

/** The reads that count each library's files. */
const READS = {
  'every library': (libraries) => libraries.list(),
  'one library': (libraries, libraryId) => libraries.get(libraryId),
} as const satisfies Record<string, Read>

/** A step that reads the files, `m`. */
const readsFiles = (step: PlanStep): boolean => /^[A-Z-]+ m\b/.test(step.detail)

/**
 * How SQLite counts each library's files for the side menu, the Libraries
 * page and Home: all of them, those no match was found for, and how many of
 * the probed ones are 4K. Reading the files themselves to count them costs
 * nothing in a small test library and a tenth of a second in a real one, on
 * every load, so the counts are checked by their plan, as SQLite plans them
 * in a fresh database and with a real library's statistics.
 */
describe.each([
  { statistics: 'no statistics', prepare: (): void => undefined },
  { statistics: "a real library's statistics", prepare: planLikeProduction },
])('how the libraries are counted, with $statistics', ({ prepare }) => {
  const database = testDatabase('raven-count-plans-')
  const state = { libraryId: 0 }

  /** Every step SQLite took for `read`. */
  const stepsOf = (read: Read): PlanStep[] => {
    const traced = tracedDatabase(database.get())
    try {
      read(new LibrariesRepository(traced.database), state.libraryId)
      return traced.steps()
    } finally {
      traced.database.onModuleDestroy()
    }
  }

  beforeEach(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    const index = new MediaIndex(database.get())
    state.libraryId = libraries.create({
      name: '4K Movies',
      paths: ['/m'],
      settings: { kind: 'movies' },
    }).id
    libraries.create({ name: 'Movies', paths: ['/n'], settings: { kind: 'movies' } })
    const ids = ['Arrival.mkv', 'Dune.mkv', 'Heat.mkv'].map((name) =>
      index.insert({
        libraryId: state.libraryId,
        kind: 'movies',
        file: { path: `/m/${name}`, root: '/m', size: 1, mtimeMs: 1 },
      }),
    )
    ids.slice(1).forEach((id) => index.saveProbe({ id, probe: PROBE, tracks: TRACKS }))
    new MatchFiles(database.get(), repositories(database.get()).metadata).setMatch({
      ids: ids.slice(0, 1),
      match: 'unmatched',
    })
    prepare(database.get())
  })

  afterEach(() => database.close())

  it.each(Object.entries(READS))(
    'counts %s from an index of each library’s own files, never reading the files',
    (_name, read) => {
      const details = stepsOf(read)
        .filter(readsFiles)
        .map((step) => step.detail)

      expect(details).not.toEqual([])
      expect(
        details.filter(
          (detail) => !/^SEARCH m USING COVERING INDEX \w+ \(library_id=\?/.test(detail),
        ),
      ).toEqual([])
    },
  )

  it('counts each library once, not again to put them in order', () => {
    const counts = stepsOf(READS['every library'])
      .filter(readsFiles)
      .map((step) => step.within.join(' > '))

    expect(counts).toEqual([...new Set(counts)])
  })
})

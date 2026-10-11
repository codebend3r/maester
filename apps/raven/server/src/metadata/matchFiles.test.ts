import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MatchFiles } from '@/metadata/matchFiles'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { testDatabase } from '@/test/database'

describe('the match queue', () => {
  const database = testDatabase('raven-match-files-')
  const state = { libraryId: 0, ids: new Map<string, number>() }
  const files = () => new MatchFiles(database.get(), new MetadataRepository(database.get()))
  const names = (found: ReadonlyArray<{ fileName: string }>): string[] =>
    found.map((file) => file.fileName)

  beforeAll(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Shows',
      paths: ['/tv'],
      settings: { kind: 'shows' },
    }).id
    const index = new MediaIndex(database.get())
    const paths = [
      '100% Show/Season 1/100% Show - S01E01.mkv',
      '100% Show/Season 1/100% Show - S01E02.mkv',
      '100X Show/100X Show - S01E01.mkv',
      'Elsewhere/Elsewhere - S01E01.mkv',
    ]
    paths.forEach((path) =>
      state.ids.set(
        path,
        index.insert({
          libraryId: state.libraryId,
          kind: 'shows',
          file: { path: `/tv/${path}`, root: '/tv', size: 1, mtimeMs: 1 },
        }),
      ),
    )
  })

  afterAll(database.close)

  it('reads files by id in the order asked, leaving out ones that are gone', () => {
    const second = state.ids.get('100% Show/Season 1/100% Show - S01E02.mkv') ?? -1
    const other = state.ids.get('Elsewhere/Elsewhere - S01E01.mkv') ?? -1
    expect(names(files().byIds([other, 999_999, second]))).toEqual([
      'Elsewhere - S01E01.mkv',
      '100% Show - S01E02.mkv',
    ])
    expect(files().byId(other)?.match).toBe('pending')
  })

  it("finds a show folder's files, season folders included, taking its name literally", () => {
    expect(names(files().underFolder({ libraryId: state.libraryId, folder: '100% Show' }))).toEqual(
      ['100% Show - S01E01.mkv', '100% Show - S01E02.mkv'],
    )
  })

  it('puts unmatched files back in the queue', () => {
    const other = state.ids.get('Elsewhere/Elsewhere - S01E01.mkv') ?? -1
    files().setMatch({ ids: [other], match: 'unmatched' })
    expect(files().pending(state.libraryId)).toHaveLength(3)
    expect(files().retryUnmatched(state.libraryId)).toBe(1)
    expect(files().pending(state.libraryId)).toHaveLength(4)
  })
})

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ProbeResult } from '@/ffmpeg/probe'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MatchFiles } from '@/metadata/matchFiles'
import { BLANK_ITEM } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

const PROBE = {
  duration: 60,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  videoBitDepth: 8,
  hdr: false,
  audioCodec: 'aac',
  audioChannels: 2,
  bitrate: 5_000_000,
}

const TRACKS = { audio: [], subtitles: [], defaultAudio: null, frameRate: 24 }

/** A video's frame as a probe found it, or null for one not probed yet. */
type Frame = Pick<ProbeResult, 'width' | 'height'> | null

const HD: Frame = { width: 1920, height: 1080 }
const UHD: Frame = { width: 3840, height: 2160 }

describe('libraries', () => {
  const database = testDatabase('raven-libraries-')
  beforeAll(database.open)
  afterAll(database.close)

  it("keeps a library's folder layout, and starts its paths unread", () => {
    const libraries = new LibrariesRepository(database.get())
    const created = libraries.create({
      name: 'Anime',
      paths: ['/media/Anime', '/media/Classics'],
      settings: { kind: 'animeShows', folderLayout: 'flat' },
    })
    expect(created.settings.folderLayout).toBe('flat')
    expect(created.layouts).toEqual([
      { path: '/media/Anime', layout: null, groups: 0 },
      { path: '/media/Classics', layout: null, groups: 0 },
    ])
  })

  it("keeps the icon a library picked, wears its type's until it picks one, and goes back to it", () => {
    const libraries = new LibrariesRepository(database.get())
    const { id, settings } = libraries.create({
      name: 'UFC',
      paths: ['/media/UFC'],
      settings: { kind: 'sports' },
    })
    expect(settings.icon).toBeNull()
    libraries.update({
      id,
      input: { name: 'UFC', paths: ['/media/UFC'], settings: { icon: 'octagon' } },
    })
    expect(libraries.get(id)?.settings.icon).toBe('octagon')
    libraries.update({
      id,
      input: { name: 'UFC', paths: ['/media/UFC'], settings: { kind: 'movies' } },
    })
    expect(libraries.get(id)?.settings.icon).toBe('octagon')
    libraries.update({
      id,
      input: { name: 'UFC', paths: ['/media/UFC'], settings: { icon: null } },
    })
    expect(libraries.get(id)?.settings.icon).toBeNull()
  })

  it('reads an icon this version does not know as the type wearing its own', () => {
    const libraries = new LibrariesRepository(database.get())
    const { id } = libraries.create({ name: 'Racing', paths: ['/media/Racing'] })
    database.get().db.prepare("UPDATE libraries SET icon = 'rocket' WHERE id = ?").run(id)
    expect(libraries.get(id)?.settings.icon).toBeNull()
  })

  it('keeps what a full scan found each path to be, until the paths change', () => {
    const libraries = new LibrariesRepository(database.get())
    const { id } = libraries.create({
      name: 'TV',
      paths: ['/media/TV'],
      settings: { kind: 'shows' },
    })
    expect(libraries.get(id)?.settings.folderLayout).toBe('auto')
    libraries.saveLayouts({ id, layouts: [{ path: '/media/TV', layout: 'lettered', groups: 27 }] })
    expect(libraries.get(id)?.layouts).toEqual([
      { path: '/media/TV', layout: 'lettered', groups: 27 },
    ])
    libraries.update({ id, input: { name: 'TV', paths: ['/media/Shows'] } })
    expect(libraries.get(id)?.layouts).toEqual([{ path: '/media/Shows', layout: null, groups: 0 }])
  })

  it('keeps what each path was found to be through a save that keeps it, and starts a new one unread', () => {
    const libraries = new LibrariesRepository(database.get())
    const { id } = libraries.create({
      name: 'Films',
      paths: ['/media/Films', '/media/Classics'],
      settings: { kind: 'movies' },
    })
    libraries.saveLayouts({
      id,
      layouts: [
        { path: '/media/Films', layout: 'lettered', groups: 26 },
        { path: '/media/Classics', layout: 'flat', groups: 0 },
      ],
    })
    libraries.update({
      id,
      input: {
        name: 'Films',
        paths: ['/media/Films', '/media/Classics'],
        settings: { pinned: true },
      },
    })
    expect(libraries.get(id)?.layouts).toEqual([
      { path: '/media/Films', layout: 'lettered', groups: 26 },
      { path: '/media/Classics', layout: 'flat', groups: 0 },
    ])
    libraries.update({
      id,
      input: { name: 'Films', paths: ['/media/Classics', '/media/Films', '/media/New'] },
    })
    expect(libraries.get(id)?.layouts).toEqual([
      { path: '/media/Classics', layout: 'flat', groups: 0 },
      { path: '/media/Films', layout: 'lettered', groups: 26 },
      { path: '/media/New', layout: null, groups: 0 },
    ])
  })

  it('remembers a Refresh, and finishes each with no title left waiting, or none asked for', () => {
    const libraries = new LibrariesRepository(database.get())
    const { metadata } = repositories(database.get())
    const index = new MediaIndex(database.get())
    const library = (name: string): { id: number; itemId: number } => {
      const { id } = libraries.create({ name, paths: [`/${name}`], settings: { kind: 'movies' } })
      const itemId = metadata.save({
        item: { ...BLANK_ITEM, type: 'movie', tmdbId: name, number: null, title: name },
      })
      metadata.link({
        mediaIds: [
          index.insert({
            libraryId: id,
            kind: 'movies',
            file: { path: `/${name}/${name}.mkv`, root: `/${name}`, size: 1, mtimeMs: 1 },
          }),
        ],
        itemIds: [itemId],
      })
      return { id, itemId }
    }
    const { id: waiting } = library('Waiting')
    const { id: done, itemId: doneItem } = library('Done')
    const { id: idle } = library('Idle')
    const { id: unasked } = library('Unasked')
    expect(libraries.ratingsRefresh(idle)).toEqual({ startedAt: null, total: 0, finishedAt: null })

    const at = '2026-10-17T09:00:00.000Z'
    expect(libraries.startRatingsRefresh({ id: waiting, at, shouldAsk: true })).toBe(1)
    expect(libraries.startRatingsRefresh({ id: done, at, shouldAsk: true })).toBe(1)
    expect(libraries.startRatingsRefresh({ id: unasked, at, shouldAsk: false })).toBe(0)
    expect(libraries.ratingsRefresh(waiting)).toEqual({ startedAt: at, total: 1, finishedAt: null })
    expect(libraries.ratingsRefresh(unasked)).toEqual({ startedAt: null, total: 0, finishedAt: at })
    expect(metadata.requestsLeft(unasked)).toBe(0)
    metadata.clearRequest(doneItem)

    const finished = '2026-10-17T09:05:00.000Z'
    libraries.finishRatingsRefreshes(finished)
    expect(libraries.ratingsRefresh(waiting)).toEqual({ startedAt: at, total: 1, finishedAt: null })
    expect(libraries.ratingsRefresh(done)).toEqual({
      startedAt: null,
      total: 1,
      finishedAt: finished,
    })
    expect(libraries.ratingsRefresh(idle)).toEqual({ startedAt: null, total: 0, finishedAt: null })
    expect(libraries.ratingsRefresh(-1)).toEqual({ startedAt: null, total: 0, finishedAt: null })
  })
})

describe('what each library holds, and the order they come in', () => {
  const database = testDatabase('raven-library-counts-')
  const libraries = () => new LibrariesRepository(database.get())

  beforeEach(database.open)
  afterEach(database.close)

  type AddLibraryProps = { name: string; frames: readonly Frame[] }

  /** A Movies library with a file for each frame, its files' ids in the same order. */
  const addLibrary = ({ name, frames }: AddLibraryProps) => {
    const index = new MediaIndex(database.get())
    const { id } = libraries().create({ name, paths: [`/${name}`], settings: { kind: 'movies' } })
    const files = frames.map((frame, position) => {
      const fileId = index.insert({
        libraryId: id,
        kind: 'movies',
        file: { path: `/${name}/${position}.mkv`, root: `/${name}`, size: 1, mtimeMs: 1 },
      })
      if (frame) index.saveProbe({ id: fileId, probe: { ...PROBE, ...frame }, tracks: TRACKS })
      return fileId
    })
    return { id, files }
  }

  it('counts every file a library holds, and those no match was found for', () => {
    const clips = addLibrary({ name: 'Clips', frames: [HD, HD, null] })
    addLibrary({ name: 'Empty', frames: [] })
    // The third stays pending: not matched yet is not "no match was found".
    new MatchFiles(database.get(), repositories(database.get()).metadata).setMatch({
      ids: clips.files.slice(0, 2),
      match: 'unmatched',
    })

    expect(
      libraries()
        .list()
        .map(({ name, itemCount, unmatchedCount }) => ({ name, itemCount, unmatchedCount })),
    ).toEqual([
      { name: 'Clips', itemCount: 3, unmatchedCount: 2 },
      { name: 'Empty', itemCount: 0, unmatchedCount: 0 },
    ])
    expect(libraries().get(clips.id)).toMatchObject({ itemCount: 3, unmatchedCount: 2 })
  })

  it('leads with the libraries whose probed videos are mostly 4K, then goes by name', () => {
    addLibrary({ name: 'Zulu', frames: [UHD] })
    // Scope 4K: short of 2160 lines, but 4K by its width. The unprobed files do not count.
    addLibrary({ name: 'Scope', frames: [{ width: 3200, height: 1340 }, null, null] })
    // 4K by its height alone.
    addLibrary({ name: 'Tall', frames: [{ width: 2880, height: 2160 }] })
    // Half is not mostly.
    addLibrary({ name: 'Mixed', frames: [UHD, HD] })
    addLibrary({ name: 'archive', frames: [] })
    addLibrary({ name: 'Clips', frames: [HD, null] })

    expect(
      libraries()
        .list()
        .map((library) => library.name),
    ).toEqual(['Scope', 'Tall', 'Zulu', 'archive', 'Clips', 'Mixed'])
  })

  it('lists the libraries in the order the admin placed them, and a new one after them', () => {
    const [zulu, scope, archive] = [
      addLibrary({ name: 'Zulu', frames: [UHD] }),
      addLibrary({ name: 'Scope', frames: [UHD] }),
      addLibrary({ name: 'archive', frames: [] }),
    ].map((library) => library.id)
    const names = () =>
      libraries()
        .list()
        .map((library) => library.name)

    expect(libraries().reorder([archive, zulu, scope])).toBe(true)
    expect(names()).toEqual(['archive', 'Zulu', 'Scope'])

    addLibrary({ name: 'Newest', frames: [UHD] })
    expect(names()).toEqual(['archive', 'Zulu', 'Scope', 'Newest'])
  })

  it('refuses an order that leaves a library out, repeats one or names one that is not there', () => {
    const first = addLibrary({ name: 'First', frames: [] }).id
    const second = addLibrary({ name: 'Second', frames: [] }).id
    const before = libraries()
      .list()
      .map((library) => library.id)

    expect(libraries().reorder([second])).toBe(false)
    expect(libraries().reorder([second, second])).toBe(false)
    expect(libraries().reorder([second, first, 9999])).toBe(false)
    expect(
      libraries()
        .list()
        .map((library) => library.id),
    ).toEqual(before)
  })
})

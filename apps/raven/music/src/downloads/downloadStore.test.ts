import { beforeEach, describe, expect, it } from 'bun:test'
import {
  ALBUM_TYPES,
  AUDIO_BITRATES,
  AUDIO_CODECS,
  type AlbumSummary,
  MATCH_STATES,
  type PlaylistSummary,
  type Track,
} from '@raven/core'
import { BROWSE_KINDS } from '@raven/native/headless'
import type { StateStorage } from 'zustand/middleware'

import {
  DOWNLOADS_FOLDER,
  DOWNLOADS_KEY,
  downloadKeyOf,
  DOWNLOAD_COPY,
  DOWNLOAD_PROGRESS,
  DOWNLOAD_SOURCES,
  DOWNLOAD_STATUSES,
  type DownloadDisk,
  configureDownloads,
  downloadProgressOf,
  downloadedLibraryOf,
  useDownloads,
} from '@/downloads/downloadStore'
import { DEFAULT_WREN_PREFS, useWrenPrefs } from '@/stores/wrenPrefs'

const SERVER_ID = 'raven'

const ALBUM: AlbumSummary = {
  id: 7,
  libraryId: 5,
  title: 'Morning Chorus',
  sortTitle: 'Morning Chorus',
  year: 2026,
  type: ALBUM_TYPES.album,
  artists: [{ id: 1, name: 'The Fixture Birds' }],
  isCompilation: false,
  trackCount: 2,
  duration: 40,
  coverVersion: 'v1',
  match: MATCH_STATES.matched,
  addedAt: '2026-10-01T00:00:00Z',
}

const PLAYLIST: PlaylistSummary = {
  id: 9,
  name: 'Road trip',
  trackCount: 1,
  duration: 20,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
}

type TrackForProps = { id: number; number: number; duration: number }

const trackFor = ({ id, number, duration }: TrackForProps): Track => ({
  id,
  libraryId: 5,
  albumId: ALBUM.id,
  title: `Track ${id}`,
  disc: 1,
  number,
  duration,
  artists: ALBUM.artists,
  container: 'flac',
  codec: AUDIO_CODECS.flac,
  bitrate: 900_000,
  sampleRate: 44_100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: ALBUM.addedAt,
  album: { title: ALBUM.title, coverVersion: ALBUM.coverVersion },
})

const FIRST = trackFor({ id: 31, number: 1, duration: 20 })
const SECOND = trackFor({ id: 32, number: 2, duration: 20 })

/** A track twenty hours long, which at 256 kbps takes 2.3 GB. */
const LONG = trackFor({ id: 40, number: 3, duration: 72_000 })

/** Two tracks ten hours long, 1.15 GB each at 256 kbps: each fits a 2 GB limit, both do not. */
const HALF_A = trackFor({ id: 41, number: 4, duration: 36_000 })
const HALF_B = trackFor({ id: 42, number: 5, duration: 36_000 })

const memoryStorage = (): StateStorage => {
  const items = new Map<string, string>()
  return {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value)
    },
    removeItem: (name) => {
      items.delete(name)
    },
  }
}

const BYTES = 1_000

const keyOf = (id: number) => downloadKeyOf({ serverId: SERVER_ID, id })

const folderOf = (path: string) => path.split('/').slice(0, -1).join('/')

/**
 * A disk in memory: a fetch writes the `.part`, then fails for an address in `failing` or moves
 * it into place. `files` is every path on it.
 */
const memoryDisk = (failing: readonly string[] = []) => {
  const files = new Set<string>()
  const disk: DownloadDisk = {
    fetch: async ({ source, path }) => {
      files.add(`${path}.part`)
      if (failing.some((uri) => source.uri.includes(uri))) throw new Error('cut off')
      files.delete(`${path}.part`)
      files.add(path)
      return BYTES
    },
    uriOf: (path) => `file:///documents/${path}`,
    exists: (path) => files.has(path),
    folders: () => [...new Set([...files].map(folderOf))],
    remove: async (folder) => {
      ;[...files]
        .filter((file) => file.startsWith(`${folder}/`))
        .forEach((file) => files.delete(file))
    },
    removeAll: async () => {
      ;[...files]
        .filter((file) => file.startsWith(`${DOWNLOADS_FOLDER}/`))
        .forEach((file) => files.delete(file))
    },
  }
  return { disk, files }
}

type SetUpProps = {
  failing?: readonly string[]
  /** What each track's source waits on before it answers; resolved at once by default. */
  hold?: Promise<void>
  storage?: StateStorage
  /** Files already on the disk before the downloads are read back. */
  onDisk?: readonly string[]
  /** What each fetch of a track waits on before it writes; resolved at once by default. */
  writeHold?: (path: string) => Promise<void>
}

const setUp = async ({
  failing = [],
  hold = Promise.resolve(),
  storage = memoryStorage(),
  onDisk = [],
  writeHold = async () => undefined,
}: SetUpProps = {}) => {
  const memory = memoryDisk(failing)
  const { files } = memory
  const disk: DownloadDisk = {
    ...memory.disk,
    fetch: async (props) => {
      await writeHold(props.path)
      return memory.disk.fetch(props)
    },
  }
  onDisk.forEach((file) => files.add(file))
  const asked: number[] = []
  await configureDownloads({
    storage,
    disk,
    sourcesOf: (serverId) =>
      serverId === SERVER_ID
        ? {
            trackSource: async ({ mediaId, kbps }) => {
              asked.push(kbps ?? 0)
              await hold
              return {
                ok: true,
                source: { uri: `https://raven.example/${mediaId}?kbps=${kbps}`, headers: {} },
              }
            },
          }
        : null,
    coverOf: async ({ track }) => ({
      uri: `https://raven.example/covers/${track.albumId}`,
      headers: {},
    }),
    accountId: () => ACCOUNT.id,
  })
  return { files, asked }
}

/** The account signed in; a test switches it by setting `id`. */
const ACCOUNT: { id: string | null } = { id: 'u1' }

const albumOf = { kind: DOWNLOAD_SOURCES.album, album: ALBUM } as const

const trackFolder = (id: number) => `${DOWNLOADS_FOLDER}/${SERVER_ID}/${id}`

describe('useDownloads', () => {
  beforeEach(() => {
    ACCOUNT.id = 'u1'
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    useDownloads.setState({ ownerId: null, entries: {}, playlists: {}, running: 0 })
  })

  it('belongs to the account it was made under, and goes only when another account signs in', async () => {
    const { files } = await setUp()
    await useDownloads
      .getState()
      .downloadTracks({ serverId: SERVER_ID, tracks: [FIRST], collection: albumOf })
    expect(useDownloads.getState().ownerId).toBe('u1')

    const { keepFor } = useDownloads.getState()
    await keepFor({ accountId: null })
    await keepFor({ accountId: 'u1' })
    expect(Object.keys(useDownloads.getState().entries)).toEqual([keyOf(FIRST.id)])

    await keepFor({ accountId: 'u2' })
    expect(useDownloads.getState().entries).toEqual({})
    expect(useDownloads.getState().ownerId).toBeNull()
    expect(files.size).toBe(0)
  })

  it('lands a fetch only on the entry it was started for, not on one queued again since', async () => {
    const firstWrite = Promise.withResolvers<void>()
    const writes: string[] = []
    const { files } = await setUp({
      writeHold: async (path) => {
        writes.push(path)
        if (writes.length === 1) await firstWrite.promise
      },
    })
    const { downloadTracks, remove } = useDownloads.getState()
    const older = downloadTracks({ serverId: SERVER_ID, tracks: [FIRST], collection: albumOf })
    await Promise.resolve()
    await remove({ serverId: SERVER_ID, mediaIds: [FIRST.id] })
    await downloadTracks({ serverId: SERVER_ID, tracks: [FIRST], collection: albumOf })
    const newer = useDownloads.getState().entries[keyOf(FIRST.id)]
    expect(newer?.status).toBe(DOWNLOAD_STATUSES.done)

    firstWrite.resolve()
    await older
    expect(useDownloads.getState().entries[keyOf(FIRST.id)]).toEqual(newer)
    expect(files.has(`${trackFolder(31)}/media.m4a`)).toBe(true)
  })

  it("downloads an album's tracks as 256 kbps transcodes, each with its cover, under the server's folder", async () => {
    const { files, asked } = await setUp()
    const refusal = await useDownloads
      .getState()
      .downloadTracks({ serverId: SERVER_ID, tracks: [FIRST, SECOND], collection: albumOf })
    expect(refusal).toBeNull()
    expect(asked).toEqual([AUDIO_BITRATES.standard, AUDIO_BITRATES.standard])
    expect([...files].toSorted()).toEqual([
      `${trackFolder(31)}/cover.jpg`,
      `${trackFolder(31)}/media.m4a`,
      `${trackFolder(32)}/cover.jpg`,
      `${trackFolder(32)}/media.m4a`,
    ])
    const entry = useDownloads.getState().entries[keyOf(FIRST.id)]
    expect(entry?.status).toBe(DOWNLOAD_STATUSES.done)
    expect(entry?.bytes).toBe(BYTES)
    expect(entry?.coverPath).toBe(`${trackFolder(31)}/cover.jpg`)
    expect(entry?.album).toEqual(ALBUM)
    expect(entry?.track).toEqual(FIRST)
  })

  it('refuses past the storage limit with the limit message, downloading nothing', async () => {
    const { files } = await setUp()
    useWrenPrefs.setState({ storageLimitGb: 2 })
    const refusal = await useDownloads
      .getState()
      .downloadTracks({ serverId: SERVER_ID, tracks: [FIRST, LONG], collection: albumOf })
    expect(refusal).toBe(DOWNLOAD_COPY.full(2))
    expect(useDownloads.getState().entries).toEqual({})
    expect(files.size).toBe(0)
  })

  it('counts the downloads still on their way against the limit', async () => {
    const gate = Promise.withResolvers<void>()
    await setUp({ hold: gate.promise })
    useWrenPrefs.setState({ storageLimitGb: 2 })
    const { downloadTracks } = useDownloads.getState()
    const first = downloadTracks({ serverId: SERVER_ID, tracks: [HALF_A], collection: albumOf })
    const second = await downloadTracks({
      serverId: SERVER_ID,
      tracks: [HALF_B],
      collection: albumOf,
    })
    expect(second).toBe(DOWNLOAD_COPY.full(2))
    gate.resolve()
    expect(await first).toBeNull()
    expect(useDownloads.getState().entries[keyOf(HALF_B.id)]).toBeUndefined()
  })

  it('leaves a failed download failed, with no file and no part left behind', async () => {
    const { files } = await setUp({ failing: [`/${SECOND.id}?`] })
    await useDownloads
      .getState()
      .downloadTracks({ serverId: SERVER_ID, tracks: [FIRST, SECOND], collection: albumOf })
    const { entries } = useDownloads.getState()
    expect(entries[keyOf(SECOND.id)]?.status).toBe(DOWNLOAD_STATUSES.failed)
    expect(entries[keyOf(FIRST.id)]?.status).toBe(DOWNLOAD_STATUSES.done)
    expect([...files].filter((file) => file.startsWith(trackFolder(32)))).toEqual([])
    expect(
      downloadProgressOf({ entries, serverId: SERVER_ID, mediaIds: [FIRST.id, SECOND.id] }),
    ).toEqual({ kind: DOWNLOAD_PROGRESS.failed, done: 1, total: 2 })
  })

  it("keeps one server's track apart from another's with the same media id", async () => {
    await setUp()
    await useDownloads
      .getState()
      .downloadTracks({ serverId: SERVER_ID, tracks: [FIRST], collection: albumOf })
    await useDownloads
      .getState()
      .downloadTracks({ serverId: 'elsewhere', tracks: [FIRST], collection: albumOf })
    const { entries } = useDownloads.getState()
    expect(entries[keyOf(FIRST.id)]?.status).toBe(DOWNLOAD_STATUSES.done)
    expect(entries[downloadKeyOf({ serverId: 'elsewhere', id: FIRST.id })]?.status).toBe(
      DOWNLOAD_STATUSES.failed,
    )
  })

  it('removes every download and the folder they are in', async () => {
    const { files } = await setUp()
    await useDownloads
      .getState()
      .downloadTracks({ serverId: SERVER_ID, tracks: [FIRST, SECOND], collection: albumOf })
    await useDownloads.getState().removeAll()
    expect(useDownloads.getState().entries).toEqual({})
    expect(files.size).toBe(0)
  })

  it('removes the tracks asked for, and a playlist once none of its tracks is left', async () => {
    const { files } = await setUp()
    await useDownloads.getState().downloadTracks({
      serverId: SERVER_ID,
      tracks: [SECOND],
      collection: { kind: DOWNLOAD_SOURCES.playlist, playlist: PLAYLIST },
    })
    expect(Object.keys(useDownloads.getState().playlists)).toEqual([keyOf(PLAYLIST.id)])
    await useDownloads.getState().remove({ serverId: SERVER_ID, mediaIds: [SECOND.id] })
    expect(useDownloads.getState().playlists).toEqual({})
    expect(files.size).toBe(0)
  })

  const savedEntry = {
    mediaId: FIRST.id,
    serverId: SERVER_ID,
    kbps: AUDIO_BITRATES.standard,
    bytes: BYTES,
    path: `${trackFolder(31)}/media.m4a`,
    coverPath: null,
    track: FIRST,
    album: ALBUM,
    status: DOWNLOAD_STATUSES.done,
    queueStamp: 1,
  }

  type SavedOfProps = { entries: Record<string, unknown> }

  const savedOf = async ({ entries }: SavedOfProps): Promise<StateStorage> => {
    const storage = memoryStorage()
    await storage.setItem(DOWNLOADS_KEY, JSON.stringify({ state: { entries, playlists: {} } }))
    return storage
  }

  it('reads back a download stopped part way as failed, drops what is not an entry, and sweeps its part', async () => {
    const stopped = { ...savedEntry, status: DOWNLOAD_STATUSES.downloading }
    const storage = await savedOf({ entries: { [keyOf(31)]: stopped, other: { mediaId: 32 } } })
    const { files } = await setUp({ storage, onDisk: [`${trackFolder(31)}/media.m4a.part`] })
    expect(useDownloads.getState().entries).toEqual({
      [keyOf(31)]: { ...stopped, status: DOWNLOAD_STATUSES.failed },
    })
    expect(files.size).toBe(0)
  })

  it('fails a finished download whose file has gone, and sweeps the folders no download holds', async () => {
    const storage = await savedOf({ entries: { [keyOf(31)]: savedEntry } })
    const stray = `${trackFolder(99)}/media.m4a`
    const { files } = await setUp({ storage, onDisk: [stray] })
    expect(useDownloads.getState().entries[keyOf(31)]?.status).toBe(DOWNLOAD_STATUSES.failed)
    expect(files.has(stray)).toBe(false)
  })

  it('keeps a finished download whose file is there', async () => {
    const storage = await savedOf({ entries: { [keyOf(31)]: savedEntry } })
    const { files } = await setUp({ storage, onDisk: [savedEntry.path] })
    expect(useDownloads.getState().entries[keyOf(31)]?.status).toBe(DOWNLOAD_STATUSES.done)
    expect(files.has(savedEntry.path)).toBe(true)
  })
})

describe('downloadedLibraryOf', () => {
  beforeEach(() => {
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    useDownloads.setState({ entries: {}, playlists: {}, running: 0 })
  })

  it("lists the server's downloaded albums and playlists, their tracks in order and their saved cover", async () => {
    await setUp()
    const { downloadTracks } = useDownloads.getState()
    await downloadTracks({ serverId: SERVER_ID, tracks: [SECOND, FIRST], collection: albumOf })
    await downloadTracks({
      serverId: SERVER_ID,
      tracks: [SECOND, FIRST],
      collection: { kind: DOWNLOAD_SOURCES.playlist, playlist: PLAYLIST },
    })
    const uriOf = (path: string) => `file:///documents/${path}`
    const library = downloadedLibraryOf({ ...useDownloads.getState(), serverId: SERVER_ID, uriOf })
    expect(library.albums()).toEqual([ALBUM])
    expect(library.playlists()).toEqual([PLAYLIST])
    expect(library.tracksOf({ kind: BROWSE_KINDS.album, albumId: ALBUM.id })).toEqual([
      FIRST,
      SECOND,
    ])
    expect(library.tracksOf({ kind: BROWSE_KINDS.playlist, playlistId: PLAYLIST.id })).toEqual([
      SECOND,
      FIRST,
    ])
    expect(library.tracksOf({ kind: BROWSE_KINDS.track, mediaId: FIRST.id })).toEqual([FIRST])
    expect(library.artworkOf({ kind: BROWSE_KINDS.album, albumId: ALBUM.id })).toBe(
      uriOf(`${trackFolder(31)}/cover.jpg`),
    )
    const other = downloadedLibraryOf({
      ...useDownloads.getState(),
      serverId: 'elsewhere',
      uriOf,
    })
    expect(other.albums()).toEqual([])
  })
})

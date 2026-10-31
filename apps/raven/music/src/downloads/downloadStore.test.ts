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

/**
 * A disk in memory: a fetch writes the `.part`, then fails for an address in `failing` or moves
 * it into place. `files` is every path on it.
 */
const memoryDisk = (failing: readonly string[] = []) => {
  const files = new Set<string>()
  const folderOf = (path: string) => path.split('/').slice(0, -1).join('/')
  const disk: DownloadDisk = {
    fetch: async ({ source, path }) => {
      files.add(`${path}.part`)
      if (failing.some((uri) => source.uri.includes(uri))) throw new Error('cut off')
      files.delete(`${path}.part`)
      files.add(path)
      return BYTES
    },
    uriOf: (path) => `file:///documents/${path}`,
    remove: async (path) => {
      const folder = folderOf(path)
      ;[...files].filter((file) => file.startsWith(folder)).forEach((file) => files.delete(file))
    },
    removeAll: async () => {
      ;[...files]
        .filter((file) => file.startsWith(`${DOWNLOADS_FOLDER}/`))
        .forEach((file) => files.delete(file))
    },
  }
  return { disk, files }
}

type SetUpProps = { failing?: readonly string[] }

const setUp = async ({ failing = [] }: SetUpProps = {}) => {
  const { disk, files } = memoryDisk(failing)
  const asked: number[] = []
  await configureDownloads({
    storage: memoryStorage(),
    disk,
    sourcesOf: (serverId) =>
      serverId === SERVER_ID
        ? {
            trackSource: async ({ mediaId, kbps }) => {
              asked.push(kbps ?? 0)
              return {
                ok: true,
                source: { uri: `https://raven.example/${mediaId}?kbps=${kbps}`, headers: {} },
              }
            },
          }
        : null,
  })
  return { files, asked }
}

const albumOf = { kind: DOWNLOAD_SOURCES.album, album: ALBUM } as const

describe('useDownloads', () => {
  beforeEach(() => {
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    useDownloads.setState({ entries: {}, playlists: {}, running: 0 })
  })

  it("downloads an album's tracks as 256 kbps transcodes under the server's folder", async () => {
    const { files, asked } = await setUp()
    const refusal = await useDownloads
      .getState()
      .downloadTracks({ serverId: SERVER_ID, tracks: [FIRST, SECOND], collection: albumOf })
    expect(refusal).toBeNull()
    expect(asked).toEqual([AUDIO_BITRATES.standard, AUDIO_BITRATES.standard])
    expect([...files].toSorted()).toEqual([
      `${DOWNLOADS_FOLDER}/${SERVER_ID}/31/media.m4a`,
      `${DOWNLOADS_FOLDER}/${SERVER_ID}/32/media.m4a`,
    ])
    const entry = useDownloads.getState().entries[FIRST.id]
    expect(entry?.status).toBe(DOWNLOAD_STATUSES.done)
    expect(entry?.bytes).toBe(BYTES)
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

  it('leaves a failed download failed, with no file and no part left behind', async () => {
    const { files } = await setUp({ failing: [`/${SECOND.id}?`] })
    await useDownloads
      .getState()
      .downloadTracks({ serverId: SERVER_ID, tracks: [FIRST, SECOND], collection: albumOf })
    const { entries } = useDownloads.getState()
    expect(entries[SECOND.id]?.status).toBe(DOWNLOAD_STATUSES.failed)
    expect(entries[FIRST.id]?.status).toBe(DOWNLOAD_STATUSES.done)
    expect([...files]).toEqual([`${DOWNLOADS_FOLDER}/${SERVER_ID}/31/media.m4a`])
    expect(
      downloadProgressOf({ entries, serverId: SERVER_ID, mediaIds: [FIRST.id, SECOND.id] }),
    ).toEqual({ kind: DOWNLOAD_PROGRESS.failed, done: 1, total: 2 })
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
    expect(Object.keys(useDownloads.getState().playlists)).toEqual([String(PLAYLIST.id)])
    await useDownloads.getState().remove({ mediaIds: [SECOND.id] })
    expect(useDownloads.getState().playlists).toEqual({})
    expect(files.size).toBe(0)
  })

  it('reads back a download stopped part way as failed, and drops what is not an entry', async () => {
    const storage = memoryStorage()
    const entry = {
      mediaId: FIRST.id,
      serverId: SERVER_ID,
      kbps: AUDIO_BITRATES.standard,
      bytes: 0,
      path: 'downloads/raven/31/media.m4a',
      track: FIRST,
      album: ALBUM,
      status: DOWNLOAD_STATUSES.downloading,
    }
    const saved = { state: { entries: { 31: entry, 32: { mediaId: 32 } }, playlists: {} } }
    await storage.setItem(DOWNLOADS_KEY, JSON.stringify(saved))
    await configureDownloads({ storage, ...memoryDisk(), sourcesOf: () => null })
    expect(useDownloads.getState().entries).toEqual({
      [FIRST.id]: { ...entry, status: DOWNLOAD_STATUSES.failed },
    })
  })
})

describe('downloadedLibraryOf', () => {
  beforeEach(() => {
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    useDownloads.setState({ entries: {}, playlists: {}, running: 0 })
  })

  it("lists the server's downloaded albums and playlists, and their tracks in order", async () => {
    await setUp()
    const { downloadTracks } = useDownloads.getState()
    await downloadTracks({ serverId: SERVER_ID, tracks: [SECOND, FIRST], collection: albumOf })
    await downloadTracks({
      serverId: SERVER_ID,
      tracks: [SECOND, FIRST],
      collection: { kind: DOWNLOAD_SOURCES.playlist, playlist: PLAYLIST },
    })
    const library = downloadedLibraryOf({ ...useDownloads.getState(), serverId: SERVER_ID })
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
    const other = downloadedLibraryOf({ ...useDownloads.getState(), serverId: 'elsewhere' })
    expect(other.albums()).toEqual([])
  })
})

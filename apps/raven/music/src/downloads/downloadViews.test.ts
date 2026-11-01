import { describe, expect, it } from 'bun:test'
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

import {
  DOWNLOAD_SOURCES,
  DOWNLOAD_STATUSES,
  type DownloadEntry,
  downloadKeyOf,
} from '@/downloads/downloadStore'
import {
  DOWNLOAD_PROGRESS,
  downloadProgressOf,
  downloadedLibraryOf,
} from '@/downloads/downloadViews'

const SERVER_ID = 'raven'

const ALBUM: AlbumSummary = {
  id: 7,
  libraryId: 5,
  title: 'Morning Chorus',
  sortTitle: 'Morning Chorus',
  year: 2026,
  releaseDate: null,
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
  trackCount: 2,
  duration: 40,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
}

type TrackForProps = { id: number; number: number }

const trackFor = ({ id, number }: TrackForProps): Track => ({
  id,
  libraryId: 5,
  albumId: ALBUM.id,
  title: `Track ${id}`,
  disc: 1,
  number,
  duration: 20,
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

const FIRST = trackFor({ id: 31, number: 1 })
const SECOND = trackFor({ id: 32, number: 2 })

const keyOf = (id: number) => downloadKeyOf({ serverId: SERVER_ID, id })

const folderOf = (id: number) => `downloads/${SERVER_ID}/${id}`

type EntryForProps = {
  track: Track
  album: AlbumSummary | null
  status?: DownloadEntry['status']
}

const entryFor = ({ track, album, status = DOWNLOAD_STATUSES.done }: EntryForProps) =>
  [
    keyOf(track.id),
    {
      mediaId: track.id,
      serverId: SERVER_ID,
      kbps: AUDIO_BITRATES.standard,
      bytes: 1_000,
      path: `${folderOf(track.id)}/media.m4a`,
      coverPath: `${folderOf(track.id)}/cover.jpg`,
      track,
      album,
      status,
      queueStamp: 1,
    },
  ] as const

const albumOf = { kind: DOWNLOAD_SOURCES.album, album: ALBUM } as const

const playlistOf = { kind: DOWNLOAD_SOURCES.playlist, playlist: PLAYLIST } as const

const savedPlaylist = (mediaIds: number[]) => ({
  [keyOf(PLAYLIST.id)]: { serverId: SERVER_ID, playlist: PLAYLIST, mediaIds },
})

const mediaIds = [FIRST.id, SECOND.id]

describe('downloadProgressOf', () => {
  it('says how far an album has come, failed in part', () => {
    const entries = Object.fromEntries([
      entryFor({ track: FIRST, album: ALBUM }),
      entryFor({ track: SECOND, album: ALBUM, status: DOWNLOAD_STATUSES.failed }),
    ])
    expect(
      downloadProgressOf({
        entries,
        playlists: {},
        serverId: SERVER_ID,
        mediaIds,
        collection: albumOf,
      }),
    ).toEqual({ kind: DOWNLOAD_PROGRESS.failed, done: 1, total: 2 })
  })

  it('reads an album a playlist brought in as not downloaded, and the playlist as done', () => {
    const entries = Object.fromEntries([
      entryFor({ track: FIRST, album: null }),
      entryFor({ track: SECOND, album: null }),
    ])
    const playlists = savedPlaylist(mediaIds)
    const props = { entries, playlists, serverId: SERVER_ID, mediaIds }
    expect(downloadProgressOf({ ...props, collection: albumOf })).toEqual({
      kind: DOWNLOAD_PROGRESS.none,
      done: 0,
      total: 2,
    })
    expect(downloadProgressOf({ ...props, collection: playlistOf })).toEqual({
      kind: DOWNLOAD_PROGRESS.done,
      done: 2,
      total: 2,
    })
  })

  it('reads a playlist an album brought in as not downloaded', () => {
    const entries = Object.fromEntries([
      entryFor({ track: FIRST, album: ALBUM }),
      entryFor({ track: SECOND, album: ALBUM }),
    ])
    expect(
      downloadProgressOf({
        entries,
        playlists: {},
        serverId: SERVER_ID,
        mediaIds,
        collection: playlistOf,
      }).kind,
    ).toBe(DOWNLOAD_PROGRESS.none)
  })
})

describe('downloadedLibraryOf', () => {
  it("lists the server's downloaded albums and playlists, their tracks in order and their saved cover", () => {
    const entries = Object.fromEntries([
      entryFor({ track: SECOND, album: ALBUM }),
      entryFor({ track: FIRST, album: ALBUM }),
    ])
    const playlists = savedPlaylist([SECOND.id, FIRST.id])
    const uriOf = (path: string) => `file:///documents/${path}`
    const library = downloadedLibraryOf({ entries, playlists, serverId: SERVER_ID, uriOf })
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
      uriOf(`${folderOf(FIRST.id)}/cover.jpg`),
    )
    const other = downloadedLibraryOf({ entries, playlists, serverId: 'elsewhere', uriOf })
    expect(other.albums()).toEqual([])
  })
})

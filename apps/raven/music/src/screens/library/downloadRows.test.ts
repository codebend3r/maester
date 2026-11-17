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

import { DOWNLOAD_STATUSES, type DownloadEntry, downloadKeyOf } from '@/downloads/downloadStore'
import { allTracksOf, downloadRowsOf, downloadsSummaryOf } from '@/screens/library/downloadRows'
import { COUNTS_COPY, KIT_COPY } from '@/ui/copy'

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
  trackCount: 3,
  duration: 60,
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
  isShared: false,
  isOwn: true,
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
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
})

const FIRST = trackFor({ id: 31, number: 1 })
const SECOND = trackFor({ id: 32, number: 2 })

type EntryForProps = { track: Track; serverId?: string }

const entryFor = ({ track, serverId = SERVER_ID }: EntryForProps) =>
  [
    downloadKeyOf({ serverId, id: track.id }),
    {
      mediaId: track.id,
      serverId,
      kbps: AUDIO_BITRATES.standard,
      bytes: 1_000_000,
      path: `downloads/${serverId}/${track.id}/media.m4a`,
      coverPath: `downloads/${serverId}/${track.id}/cover.jpg`,
      track,
      album: ALBUM,
      status: DOWNLOAD_STATUSES.done,
      queueStamp: 1,
    } satisfies DownloadEntry,
  ] as const

const ENTRIES = Object.fromEntries([
  entryFor({ track: FIRST }),
  entryFor({ track: SECOND }),
  entryFor({ track: trackFor({ id: 40, number: 3 }), serverId: 'another' }),
])

const PLAYLISTS = {
  [downloadKeyOf({ serverId: SERVER_ID, id: PLAYLIST.id })]: {
    serverId: SERVER_ID,
    playlist: PLAYLIST,
    mediaIds: [SECOND.id],
  },
}

describe('downloadRowsOf', () => {
  it('lists the albums, then the playlists, each with what it holds and takes', () => {
    const rows = downloadRowsOf({
      entries: ENTRIES,
      playlists: PLAYLISTS,
      serverId: SERVER_ID,
      uriOf: (path) => `file:///${path}`,
    })
    expect(rows.map(({ title }) => title)).toEqual([ALBUM.title, PLAYLIST.name])
    const [album, playlist] = rows
    expect(album?.line).toBe(
      KIT_COPY.facts(['The Fixture Birds', COUNTS_COPY.partOf({ done: 2, total: 3 })]),
    )
    expect(album?.bytes).toBe(2_000_000)
    expect(album?.artworkUri).toBe(`file:///downloads/${SERVER_ID}/31/cover.jpg`)
    expect(playlist?.tracks).toEqual([SECOND])
    expect(playlist?.bytes).toBe(1_000_000)
    expect(allTracksOf(rows)).toEqual([FIRST, SECOND])
  })
})

describe('downloadsSummaryOf', () => {
  it("counts this server's albums, playlists and bytes alone", () => {
    expect(
      downloadsSummaryOf({ entries: ENTRIES, playlists: PLAYLISTS, serverId: SERVER_ID }),
    ).toEqual({
      albums: 1,
      playlists: 1,
      bytes: 2_000_000,
    })
  })
})

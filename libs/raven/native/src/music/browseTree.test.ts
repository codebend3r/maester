import { describe, expect, it } from 'bun:test'
import { BROWSE_ROOTS } from '@raven/audio/contract'
import {
  ALBUM_TYPES,
  ApiError,
  type AlbumDetails,
  type AlbumSummary,
  FOLDER_LAYOUTS,
  LIBRARY_KINDS,
  LIBRARY_VIEWS,
  type Library,
  LOCKED_STATUS,
  MATCH_STATES,
  MEDIA_GROUPINGS,
  MEDIA_SORTS,
  type MusicListOptions,
  type PlaylistDetails,
  type PlaylistSummary,
  QUEUE_SOURCE_KINDS,
  RATINGS_REFRESH_STATES,
  RATING_SOURCES,
  SCAN_KINDS,
  SCAN_STATES,
  type Track,
} from '@raven/core'

import {
  BROWSE_KINDS,
  BROWSE_TITLES,
  type BrowseApi,
  type BrowseTarget,
  type DownloadedLibrary,
  browseChildrenOf,
  browseIdOf,
  parseBrowseId,
  queueSourceOf,
  tracksForBrowse,
} from '@/music/browseTree'

type LibraryForProps = { id: number; kind: Library['settings']['kind'] }

const libraryFor = ({ id, kind }: LibraryForProps): Library => ({
  id,
  name: `Library ${id}`,
  paths: [],
  layouts: [],
  itemCount: 0,
  unmatchedCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  scan: {
    state: SCAN_STATES.idle,
    kind: SCAN_KINDS.full,
    found: 0,
    processed: 0,
    startedAt: null,
    finishedAt: null,
    quickScannedAt: null,
    error: null,
  },
  settings: {
    saveProgress: false,
    pinned: true,
    inHero: false,
    sort: MEDIA_SORTS.title,
    view: LIBRARY_VIEWS.grid,
    groupBy: MEDIA_GROUPINGS.resolution,
    watchedPercent: 95,
    kind,
    ratingsSource: RATING_SOURCES.tmdb,
    autoRefresh: true,
    locked: false,
    folderLayout: FOLDER_LAYOUTS.auto,
    icon: null,
  },
  backdrop: null,
  ratingsRefresh: { state: RATINGS_REFRESH_STATES.idle, finishedAt: null },
})

type AlbumForProps = { id: number; libraryId: number; addedAt: string }

const albumFor = ({ id, libraryId, addedAt }: AlbumForProps): AlbumSummary => ({
  id,
  libraryId,
  title: `Album ${id}`,
  sortTitle: `Album ${id}`,
  year: 2001,
  type: ALBUM_TYPES.album,
  artists: [{ id: 1, name: 'Radiohead' }],
  isCompilation: false,
  trackCount: 2,
  duration: 400,
  coverVersion: id % 2 === 0 ? `v${id}` : null,
  match: MATCH_STATES.matched,
  addedAt,
})

type TrackForProps = { id: number; albumId: number; disc: number }

const trackFor = ({ id, albumId, disc }: TrackForProps): Track => ({
  id,
  libraryId: 5,
  albumId,
  title: `Track ${id}`,
  disc,
  number: id,
  duration: 200,
  artists: [{ id: 1, name: 'Radiohead' }],
  container: 'flac',
  codec: 'flac',
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: `Album ${albumId}`, coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
})

const MUSIC = libraryFor({ id: 5, kind: LIBRARY_KINDS.music })
const MORE_MUSIC = libraryFor({ id: 6, kind: LIBRARY_KINDS.music })
const FILMS = libraryFor({ id: 7, kind: LIBRARY_KINDS.movies })

/** A day's timestamp, so a later day is a more recent addition. */
const dayOf = (day: number): string => new Date(Date.UTC(2026, 0, day)).toISOString()

/** 80 albums in each music library, interleaved by day, the second library's the newer of each pair. */
const ALBUMS: Record<number, AlbumSummary[]> = {
  [MUSIC.id]: Array.from({ length: 80 }, (_, index) =>
    albumFor({ id: 1000 + index, libraryId: MUSIC.id, addedAt: dayOf(index * 2 + 1) }),
  ),
  [MORE_MUSIC.id]: Array.from({ length: 80 }, (_, index) =>
    albumFor({ id: 2000 + index, libraryId: MORE_MUSIC.id, addedAt: dayOf(index * 2 + 2) }),
  ),
}

const PLAYLIST: PlaylistSummary = {
  id: 9,
  name: 'Road trip',
  trackCount: 2,
  duration: 400,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  isShared: false,
  isOwn: true,
}

const ALBUM_TRACKS = [
  trackFor({ id: 31, albumId: 3, disc: 1 }),
  trackFor({ id: 32, albumId: 3, disc: 2 }),
]
const PLAYLIST_TRACKS = [
  trackFor({ id: 44, albumId: 4, disc: 1 }),
  trackFor({ id: 31, albumId: 3, disc: 1 }),
]

type ListAlbumsProps = { libraryId: number } & MusicListOptions

const fakeApi = () => {
  const asked: ListAlbumsProps[] = []
  const api: BrowseApi = {
    listLibraries: () => Promise.resolve([MUSIC, FILMS, MORE_MUSIC]),
    listAlbums: (props: ListAlbumsProps) => {
      asked.push(props)
      return Promise.resolve(ALBUMS[props.libraryId] ?? [])
    },
    listPlaylists: () => Promise.resolve([PLAYLIST]),
    getAlbum: (id: number): Promise<AlbumDetails> =>
      Promise.resolve({
        album: albumFor({ id, libraryId: MUSIC.id, addedAt: dayOf(1) }),
        label: null,
        genres: [],
        mbid: null,
        discCount: 2,
        tracks: ALBUM_TRACKS,
        isFavourite: false,
      }),
    getPlaylist: (id: number): Promise<PlaylistDetails> =>
      Promise.resolve({ playlist: { ...PLAYLIST, id }, tracks: PLAYLIST_TRACKS }),
    albumCoverUrl: ({ albumId, coverVersion }) =>
      coverVersion === null
        ? null
        : `https://raven.example/api/pictures/albums/${albumId}/${coverVersion}`,
  }
  return { api, asked }
}

const DOWNLOADED_ALBUMS = [
  albumFor({ id: 3, libraryId: MUSIC.id, addedAt: dayOf(1) }),
  albumFor({ id: 4, libraryId: MUSIC.id, addedAt: dayOf(2) }),
]

/** The cover saved beside album 3's tracks. */
const SAVED_COVER = 'file:///documents/downloads/raven/31/cover.jpg'

const DOWNLOADED_PLAYLIST = { ...PLAYLIST, id: 12, name: 'Offline mix' }

/** Two downloaded albums and a playlist, and album 3's tracks and one of album 4's on the device. */
const downloads: DownloadedLibrary = {
  albums: () => DOWNLOADED_ALBUMS,
  playlists: () => [DOWNLOADED_PLAYLIST],
  artworkOf: (target: BrowseTarget) =>
    target.kind === BROWSE_KINDS.album && target.albumId === 3 ? SAVED_COVER : null,
  tracksOf: (target: BrowseTarget) => {
    switch (target.kind) {
      case BROWSE_KINDS.album:
        return target.albumId === 3 ? ALBUM_TRACKS : []
      case BROWSE_KINDS.playlist:
        return []
      case BROWSE_KINDS.track:
        return [...ALBUM_TRACKS, ...PLAYLIST_TRACKS.slice(0, 1)].filter(
          ({ id }) => id === target.mediaId,
        )
      default: {
        const unknown: never = target
        return unknown
      }
    }
  },
}

describe('the browse tree', () => {
  it('gives Albums, Playlists and Downloads at the root, as folders', async () => {
    const { api } = fakeApi()
    const nodes = await browseChildrenOf({ api, downloads, parentId: BROWSE_ROOTS.home })
    expect(nodes).toEqual([
      {
        id: BROWSE_ROOTS.albums,
        title: BROWSE_TITLES.albums,
        subtitle: null,
        artworkUri: null,
        isPlayable: false,
      },
      {
        id: BROWSE_ROOTS.playlists,
        title: BROWSE_TITLES.playlists,
        subtitle: null,
        artworkUri: null,
        isPlayable: false,
      },
      {
        id: BROWSE_ROOTS.downloads,
        title: BROWSE_TITLES.downloads,
        subtitle: null,
        artworkUri: null,
        isPlayable: false,
      },
    ])
  })

  it('gives the 100 most recently added albums across the music libraries, playable, with covers', async () => {
    const { api, asked } = fakeApi()
    const nodes = await browseChildrenOf({ api, downloads, parentId: BROWSE_ROOTS.albums })
    expect(asked.map(({ libraryId }) => libraryId)).toEqual([MUSIC.id, MORE_MUSIC.id])
    expect(nodes).toHaveLength(100)
    expect(nodes.every(({ isPlayable }) => isPlayable)).toBe(true)
    // Newest first: library 6's last album, added on day 160, then library 5's, on day 159.
    expect(nodes.slice(0, 2).map(({ id }) => id)).toEqual(['album:2079', 'album:1079'])
    expect(nodes[0]).toEqual({
      id: 'album:2079',
      title: 'Album 2079',
      subtitle: 'Radiohead',
      artworkUri: null,
      isPlayable: true,
    })
    expect(nodes[2]?.artworkUri).toBe('https://raven.example/api/pictures/albums/2078/v2078')
    // The 100th is day 61's album, so day 60's and older are left out.
    expect(nodes.at(-1)?.id).toBe('album:1030')
  })

  it('leaves out a PIN-locked library and still lists the others', async () => {
    const { api } = fakeApi()
    const locked: BrowseApi = {
      ...api,
      listAlbums: (props: ListAlbumsProps) =>
        props.libraryId === MUSIC.id
          ? Promise.reject(new ApiError({ status: LOCKED_STATUS, message: 'Locked' }))
          : api.listAlbums(props),
    }
    const nodes = await browseChildrenOf({ api: locked, downloads, parentId: BROWSE_ROOTS.albums })
    expect(nodes).toHaveLength(80)
    expect(nodes.every(({ id }) => id.startsWith('album:2'))).toBe(true)
  })

  it('fails the listing when a library fails for any other reason', async () => {
    const { api } = fakeApi()
    const failing: BrowseApi = {
      ...api,
      listAlbums: () => Promise.reject(new ApiError({ status: 500, message: 'Broken' })),
    }
    await expect(
      browseChildrenOf({ api: failing, downloads, parentId: BROWSE_ROOTS.albums }),
    ).rejects.toThrow('Broken')
  })

  it("gives the account's playlists, playable", async () => {
    const { api } = fakeApi()
    const nodes = await browseChildrenOf({ api, downloads, parentId: BROWSE_ROOTS.playlists })
    expect(nodes).toEqual([
      { id: 'playlist:9', title: 'Road trip', subtitle: null, artworkUri: null, isPlayable: true },
    ])
  })

  it('gives the downloaded albums, then the downloaded playlists, under Downloads', async () => {
    const { api } = fakeApi()
    const nodes = await browseChildrenOf({ api, downloads, parentId: BROWSE_ROOTS.downloads })
    expect(nodes.map(({ id }) => id)).toEqual(['album:3', 'album:4', 'playlist:12'])
    expect(nodes[0]?.artworkUri).toBe(SAVED_COVER)
    expect(nodes[1]?.artworkUri).toBe('https://raven.example/api/pictures/albums/4/v4')
  })

  it('offline, gives what is downloaded only, with the covers saved beside them', async () => {
    const albums = await browseChildrenOf({ api: null, downloads, parentId: BROWSE_ROOTS.albums })
    expect(albums.map(({ id }) => id)).toEqual(['album:3', 'album:4'])
    expect(albums.map(({ artworkUri }) => artworkUri)).toEqual([SAVED_COVER, null])
    const offline = await browseChildrenOf({
      api: null,
      downloads,
      parentId: BROWSE_ROOTS.downloads,
    })
    expect(offline.map(({ id }) => id)).toEqual(['album:3', 'album:4', 'playlist:12'])
    expect(
      await browseChildrenOf({ api: null, downloads, parentId: BROWSE_ROOTS.playlists }),
    ).toEqual([
      {
        id: 'playlist:12',
        title: 'Offline mix',
        subtitle: null,
        artworkUri: null,
        isPlayable: true,
      },
    ])
  })

  it('gives nothing under a playable node or an id it does not know', async () => {
    const { api } = fakeApi()
    expect(await browseChildrenOf({ api, downloads, parentId: 'album:3' })).toEqual([])
    expect(await browseChildrenOf({ api, downloads, parentId: 'mixes' })).toEqual([])
  })
})

describe('browse ids', () => {
  it('reads back each id it writes', () => {
    const targets: BrowseTarget[] = [
      { kind: BROWSE_KINDS.album, albumId: 3 },
      { kind: BROWSE_KINDS.playlist, playlistId: 9 },
      { kind: BROWSE_KINDS.track, mediaId: 31 },
    ]
    expect(targets.map(browseIdOf)).toEqual(['album:3', 'playlist:9', 'track:31'])
    expect(targets.map((target) => parseBrowseId(browseIdOf(target)))).toEqual(targets)
  })

  it('refuses an id that is not a kind and a positive whole number', () => {
    const refused = [
      'album:x',
      'album:',
      'album:0',
      'album:-3',
      'album:3.5',
      'album:03',
      'album:3:4',
      'artist:3',
      'albums',
      BROWSE_ROOTS.home,
      '',
    ]
    refused.forEach((id) => expect(parseBrowseId(id)).toBeNull())
  })
})

describe('the tracks a browse node plays', () => {
  it("plays an album's tracks in disc order, a playlist's in order, and one track", async () => {
    const { api } = fakeApi()
    expect(await tracksForBrowse({ api, downloads, id: 'album:3' })).toEqual(ALBUM_TRACKS)
    expect(await tracksForBrowse({ api, downloads, id: 'playlist:9' })).toEqual(PLAYLIST_TRACKS)
    expect(await tracksForBrowse({ api, downloads, id: 'track:44' })).toEqual([PLAYLIST_TRACKS[0]])
  })

  it('offline, plays the downloaded tracks', async () => {
    expect(await tracksForBrowse({ api: null, downloads, id: 'album:3' })).toEqual(ALBUM_TRACKS)
    expect(await tracksForBrowse({ api: null, downloads, id: 'album:4' })).toEqual([])
    expect(await tracksForBrowse({ api: null, downloads, id: 'track:31' })).toEqual([
      ALBUM_TRACKS[0],
    ])
  })

  it('plays nothing for an id it cannot read', async () => {
    const { api } = fakeApi()
    expect(await tracksForBrowse({ api, downloads, id: 'album:x' })).toEqual([])
  })
})

describe('queueSourceOf', () => {
  it('plays an album or a playlist as its own source, and one track as none', () => {
    expect(queueSourceOf({ kind: BROWSE_KINDS.album, albumId: 3 })).toEqual({
      kind: QUEUE_SOURCE_KINDS.album,
      id: 3,
    })
    expect(queueSourceOf({ kind: BROWSE_KINDS.playlist, playlistId: 9 })).toEqual({
      kind: QUEUE_SOURCE_KINDS.playlist,
      id: 9,
    })
    expect(queueSourceOf({ kind: BROWSE_KINDS.track, mediaId: 31 })).toBeNull()
  })
})

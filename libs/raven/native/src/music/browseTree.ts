import { BROWSE_ROOTS, type BrowseNode } from '@raven/audio/contract'
import {
  type AlbumSummary,
  type ApiClient,
  MUSIC_SORTS,
  type PlaylistSummary,
  type Track,
  artistNames,
  isLockedError,
  isMediaId,
} from '@raven/core'

import { musicLibrariesOf } from '@/music/musicLibraries'

/** What a browse id names: an album, a playlist or one track. */
export const BROWSE_KINDS = { album: 'album', playlist: 'playlist', track: 'track' } as const

type BrowseKind = (typeof BROWSE_KINDS)[keyof typeof BROWSE_KINDS]

const isBrowseKind = (value: string): value is BrowseKind =>
  Object.values<string>(BROWSE_KINDS).includes(value)

export type BrowseTarget =
  | { kind: typeof BROWSE_KINDS.album; albumId: number }
  | { kind: typeof BROWSE_KINDS.playlist; playlistId: number }
  | { kind: typeof BROWSE_KINDS.track; mediaId: number }

/** What CarPlay and Android Auto show as the root's three folders. */
export const BROWSE_TITLES = {
  albums: 'Albums',
  playlists: 'Playlists',
  downloads: 'Downloads',
} as const

/** How many recently added albums the Albums folder lists. */
const RECENT_ALBUMS = 100

const ID_SEPARATOR = ':'

/** A positive whole number written plainly: no sign, no leading zero, no fraction. */
const WHOLE_NUMBER = /^[1-9]\d*$/u

/** The calls the browse tree makes of the server. */
export type BrowseApi = Pick<
  ApiClient,
  'listLibraries' | 'listAlbums' | 'listPlaylists' | 'getAlbum' | 'getPlaylist' | 'albumCoverUrl'
>

/** What is on the device: the downloaded albums and playlists, and the tracks of a target that are downloaded. */
export type DownloadedLibrary = {
  albums(): AlbumSummary[]
  playlists(): PlaylistSummary[]
  /** An album's tracks in disc order, a playlist's in order, or the one track; empty for none. */
  tracksOf(target: BrowseTarget): Track[]
  /** The cover saved with a target's tracks, as a `file://` address; null for none. */
  artworkOf(target: BrowseTarget): string | null
}

/** The id a target goes by in the browse tree: `album:3`, `playlist:9` or `track:31`. */
export const browseIdOf = (target: BrowseTarget): string => {
  switch (target.kind) {
    case BROWSE_KINDS.album:
      return [target.kind, target.albumId].join(ID_SEPARATOR)
    case BROWSE_KINDS.playlist:
      return [target.kind, target.playlistId].join(ID_SEPARATOR)
    case BROWSE_KINDS.track:
      return [target.kind, target.mediaId].join(ID_SEPARATOR)
    default: {
      const unknown: never = target
      return unknown
    }
  }
}

type TargetOfProps = { kind: BrowseKind; id: number }

const targetOf = ({ kind, id }: TargetOfProps): BrowseTarget => {
  switch (kind) {
    case BROWSE_KINDS.album:
      return { kind, albumId: id }
    case BROWSE_KINDS.playlist:
      return { kind, playlistId: id }
    case BROWSE_KINDS.track:
      return { kind, mediaId: id }
    default: {
      const unknown: never = kind
      return unknown
    }
  }
}

/** What a browse id names; null for a root, or for anything not a kind and a positive whole number. */
export const parseBrowseId = (id: string): BrowseTarget | null => {
  const [kind, number, ...rest] = id.split(ID_SEPARATOR)
  if (kind === undefined || number === undefined || rest.length > 0) return null
  if (!isBrowseKind(kind) || !WHOLE_NUMBER.test(number)) return null
  const parsed = Number(number)
  return isMediaId(parsed) ? targetOf({ kind, id: parsed }) : null
}

type FolderOfProps = { id: string; title: string }

const folderOf = ({ id, title }: FolderOfProps): BrowseNode => ({
  id,
  title,
  subtitle: null,
  artworkUri: null,
  isPlayable: false,
})

const ROOT_NODES: readonly BrowseNode[] = [
  folderOf({ id: BROWSE_ROOTS.albums, title: BROWSE_TITLES.albums }),
  folderOf({ id: BROWSE_ROOTS.playlists, title: BROWSE_TITLES.playlists }),
  folderOf({ id: BROWSE_ROOTS.downloads, title: BROWSE_TITLES.downloads }),
]

type AlbumNodeOfProps = { api: BrowseApi | null; album: AlbumSummary }

const albumNodeOf = ({ api, album }: AlbumNodeOfProps): BrowseNode => ({
  id: browseIdOf({ kind: BROWSE_KINDS.album, albumId: album.id }),
  title: album.title,
  subtitle: artistNames(album),
  artworkUri: api?.albumCoverUrl({ albumId: album.id, coverVersion: album.coverVersion }) ?? null,
  isPlayable: true,
})

const playlistNodeOf = (playlist: PlaylistSummary): BrowseNode => ({
  id: browseIdOf({ kind: BROWSE_KINDS.playlist, playlistId: playlist.id }),
  title: playlist.name,
  subtitle: null,
  artworkUri: null,
  isPlayable: true,
})

type DownloadedNodeOfProps = { downloads: DownloadedLibrary; node: BrowseNode }

/** A downloaded album or playlist wears the cover saved with it, which shows offline too. */
const downloadedNodeOf = ({ downloads, node }: DownloadedNodeOfProps): BrowseNode => {
  const target = parseBrowseId(node.id)
  const artworkUri = target === null ? null : downloads.artworkOf(target)
  return artworkUri === null ? node : { ...node, artworkUri }
}

const newestFirst = (a: AlbumSummary, b: AlbumSummary): number => {
  if (a.addedAt === b.addedAt) return b.id - a.id
  return a.addedAt < b.addedAt ? 1 : -1
}

/**
 * The most recently added albums across every music library. The server orders each library's
 * by `added` but lists them whole, ignoring `limit`, so the merge is trimmed here. A locked
 * library is left out rather than hiding the rest.
 */
const recentAlbumsOf = async (api: BrowseApi): Promise<AlbumSummary[]> => {
  const libraries = musicLibrariesOf(await api.listLibraries())
  const listed = await Promise.all(
    libraries.map((library) =>
      api
        .listAlbums({ libraryId: library.id, sort: MUSIC_SORTS.added, limit: RECENT_ALBUMS })
        .catch((error: unknown) => {
          // A PIN-locked library is listed but answers 423; the car cannot unlock it.
          if (isLockedError(error)) return []
          throw error
        }),
    ),
  )
  return listed.flat().toSorted(newestFirst).slice(0, RECENT_ALBUMS)
}

type BrowseChildrenOfProps = {
  /** The server's client; null offline, when only what is downloaded is listed. */
  api: BrowseApi | null
  downloads: DownloadedLibrary
  parentId: string
}

/**
 * The children CarPlay or Android Auto asked for under `parentId`: the root's folders, the
 * recently added albums, the playlists, or the downloaded albums and playlists. Offline, Albums
 * lists the downloaded albums and Playlists the downloaded playlists. A playable node and an
 * unknown id have none.
 */
export const browseChildrenOf = async ({
  api,
  downloads,
  parentId,
}: BrowseChildrenOfProps): Promise<BrowseNode[]> => {
  const downloadedAlbums = () =>
    downloads
      .albums()
      .map((album) => downloadedNodeOf({ downloads, node: albumNodeOf({ api, album }) }))
  const downloadedPlaylists = () =>
    downloads
      .playlists()
      .map((playlist) => downloadedNodeOf({ downloads, node: playlistNodeOf(playlist) }))
  switch (parentId) {
    case BROWSE_ROOTS.home:
      return [...ROOT_NODES]
    case BROWSE_ROOTS.albums:
      if (api === null) return downloadedAlbums()
      return (await recentAlbumsOf(api)).map((album) => albumNodeOf({ api, album }))
    case BROWSE_ROOTS.playlists:
      if (api === null) return downloadedPlaylists()
      return (await api.listPlaylists()).map(playlistNodeOf)
    case BROWSE_ROOTS.downloads:
      return [...downloadedAlbums(), ...downloadedPlaylists()]
    default:
      return []
  }
}

type TracksForBrowseProps = {
  /** The server's client; null offline, when only downloaded tracks play. */
  api: BrowseApi | null
  downloads: DownloadedLibrary
  /** A playable node's id. */
  id: string
}

/**
 * What a playable node plays: an album's tracks in disc order, a playlist's in order, or one
 * track. A track comes from the downloads, the server having no call for a single track, and
 * everything does offline. An id it cannot read plays nothing.
 */
export const tracksForBrowse = async ({
  api,
  downloads,
  id,
}: TracksForBrowseProps): Promise<Track[]> => {
  const target = parseBrowseId(id)
  if (target === null) return []
  if (api === null) return downloads.tracksOf(target)
  switch (target.kind) {
    case BROWSE_KINDS.album:
      return (await api.getAlbum(target.albumId)).tracks
    case BROWSE_KINDS.playlist:
      return (await api.getPlaylist(target.playlistId)).tracks
    case BROWSE_KINDS.track:
      return downloads.tracksOf(target)
    default: {
      const unknown: never = target
      return unknown
    }
  }
}

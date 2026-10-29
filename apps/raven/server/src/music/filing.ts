import { basename, dirname } from 'node:path'
import { ALBUM_TYPES, type AlbumType, titleFromFileName } from '@raven/core'
import type { AudioTags } from '@/music/audioReader'

/** The names a file with no album artist is filed under. */
export const FALLBACK_ARTISTS = { unknown: 'Unknown Artist', various: 'Various Artists' } as const

/** A name as it is found again: lowercased, unaccented, one space between words. */
export const nameKeyOf = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

type AlbumTypeOfProps = Pick<AudioTags, 'releaseTypes' | 'isCompilation'>

/** What a release is, from its MusicBrainz release types, the strongest word first. */
export const albumTypeOf = ({ releaseTypes, isCompilation }: AlbumTypeOfProps): AlbumType => {
  const types = new Set(releaseTypes)
  if (types.has(ALBUM_TYPES.soundtrack)) return ALBUM_TYPES.soundtrack
  if (types.has(ALBUM_TYPES.live)) return ALBUM_TYPES.live
  if (types.has(ALBUM_TYPES.compilation) || isCompilation) return ALBUM_TYPES.compilation
  if (types.has(ALBUM_TYPES.single)) return ALBUM_TYPES.single
  if (types.has(ALBUM_TYPES.ep)) return ALBUM_TYPES.ep
  return ALBUM_TYPES.album
}

/** An artist as a file names one: the name, and the MusicBrainz id when the tags pair one with it. */
export type NamedArtist = { name: string; mbid: string | null }

type NamedArtistsProps = { names: readonly string[]; mbids: readonly string[] }

/** Each name with its id, where the tags list as many ids as names; else with none. */
const namedArtists = ({ names, mbids }: NamedArtistsProps): NamedArtist[] =>
  names.map((name, at) => ({
    name,
    mbid: mbids.length === names.length ? (mbids[at] ?? null) : null,
  }))

/** How a file is filed: its album's identity and credits, read off its tags and, failing those, its folder. */
export type Filing = {
  albumKey: string
  albumTitle: string
  albumArtists: NamedArtist[]
  /** Whether the album's artists come from its tags, or stand in from the track, the folder or a fallback. */
  isAlbumCredited: boolean
  trackArtists: NamedArtist[]
  trackTitle: string
}

type FilingOfProps = { tags: AudioTags; path: string }

/**
 * A file with tags is filed by them: by its release id, else by its album
 * artist and album. One without is filed by its folder, the `Artist/Album`
 * layout most libraries use: the folder is the album, the folder above the
 * artist. A compilation with no album artist is Various Artists'.
 */
export const filingOf = ({ tags, path }: FilingOfProps): Filing => {
  const folder = dirname(path)
  const trackArtists = namedArtists({ names: tags.artists, mbids: tags.artistMbids })
  const taggedAlbumArtists = namedArtists({
    names: tags.albumArtists,
    mbids: tags.albumArtistMbids,
  })
  const albumArtists =
    taggedAlbumArtists.length > 0
      ? taggedAlbumArtists
      : tags.isCompilation
        ? [{ name: FALLBACK_ARTISTS.various, mbid: null }]
        : trackArtists.length > 0
          ? trackArtists
          : [{ name: basename(dirname(folder)) || FALLBACK_ARTISTS.unknown, mbid: null }]
  const albumTitle = tags.album ?? (basename(folder) || FALLBACK_ARTISTS.unknown)
  const albumKey =
    tags.releaseMbid !== null
      ? `mbid:${tags.releaseMbid}`
      : tags.album !== null
        ? `name:${nameKeyOf(albumArtists[0]?.name ?? '')}:${nameKeyOf(tags.album)}`
        : `folder:${folder}`
  return {
    albumKey,
    albumTitle,
    albumArtists,
    isAlbumCredited: taggedAlbumArtists.length > 0,
    trackArtists: trackArtists.length > 0 ? trackArtists : albumArtists,
    trackTitle: tags.title ?? titleFromFileName(basename(path)),
  }
}

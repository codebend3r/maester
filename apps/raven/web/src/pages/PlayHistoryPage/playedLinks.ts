import {
  type AppPath,
  PLAYED_KINDS,
  type PlayHistoryEntry,
  episodeCode,
  episodePath,
  inLibrary,
  moviePath,
  showPath,
  watchPageOf,
} from '@raven/core'

/** A piece of text in a history row, and the page it opens; null for plain text. */
export type PlayedPart = { key: string; text: string; to: string | null }

/** What one row shows: its title, and what it belongs to as groups (a show, an episode; artists, an album). */
export type PlayedLinks = {
  title: PlayedPart
  /** Groups shown one after another; the parts inside one (a track's artists) are a list of their own. */
  from: readonly (readonly PlayedPart[])[]
}

/** Where the music links go, from the mode the page is in. */
type MusicPages = {
  album: (albumId: number) => string
  artist: (artistId: number) => string
}

type ItemPageProps = { entry: PlayHistoryEntry; page: AppPath | null }

/** The matched item's page as the entry's library shows it, Play on the file that played; else that file's player. */
const itemPageOf = ({ entry, page }: ItemPageProps): string =>
  page === null
    ? watchPageOf(entry.mediaId)
    : inLibrary({ page, libraryId: entry.libraryId, file: entry.mediaId })

const PART_KEYS = {
  title: 'title',
  year: 'year',
  show: 'show',
  code: 'code',
  artist: 'artist',
  album: 'album',
} as const

type PlayedLinksProps = { entry: PlayHistoryEntry; music: MusicPages }

/**
 * Every part of a history row that leads somewhere: a film's or an episode's
 * page, where it resumes; an episode's show; a track's artists and album. A
 * track has no page of its own, so its title opens its album. An entry from
 * a server older than these ids keeps its parts as plain text, but for a
 * video's title, which opens its player.
 */
export const playedLinks = ({ entry, music }: PlayedLinksProps): PlayedLinks => {
  const { played } = entry
  switch (played.kind) {
    case PLAYED_KINDS.video: {
      const itemId = played.itemId ?? null
      const page = itemPageOf({ entry, page: itemId === null ? null : moviePath(itemId) })
      return {
        title: { key: PART_KEYS.title, text: played.title, to: page },
        from:
          played.year === null
            ? []
            : [[{ key: PART_KEYS.year, text: String(played.year), to: null }]],
      }
    }
    case PLAYED_KINDS.episode: {
      const itemId = played.itemId ?? null
      const page = itemPageOf({ entry, page: itemId === null ? null : episodePath(itemId) })
      const code = episodeCode(played)
      const show = played.showId === undefined ? null : showPath(played.showId)
      return {
        title: { key: PART_KEYS.title, text: played.title, to: page },
        from: [
          [{ key: PART_KEYS.show, text: played.show, to: show }],
          ...(code === null ? [] : [[{ key: PART_KEYS.code, text: code, to: page }]]),
        ],
      }
    }
    case PLAYED_KINDS.track: {
      const album = music.album(played.albumId)
      const artists = (played.artists ?? []).map((artist): PlayedPart => ({
        key: `${PART_KEYS.artist}:${artist.id}`,
        text: artist.name,
        to: music.artist(artist.id),
      }))
      const byName: PlayedPart[] =
        played.artist === null ? [] : [{ key: PART_KEYS.artist, text: played.artist, to: null }]
      const credited = artists.length > 0 ? artists : byName
      return {
        title: { key: PART_KEYS.title, text: played.title, to: album },
        from: [
          ...(credited.length > 0 ? [credited] : []),
          [{ key: PART_KEYS.album, text: played.album, to: album }],
        ],
      }
    }
    default: {
      const unreachable: never = played
      return unreachable
    }
  }
}

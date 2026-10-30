import { type AlbumSummary, type ApiClient, artistNames } from '@raven/core'

import { CARD_SHAPES, type Pictures, type ShelfCard, pictureAt } from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'
import { ROUTE_TARGETS } from '@/routes'

type AlbumCardProps = Pick<Pictures, 'headersFor'> & {
  api: Pick<ApiClient, 'albumCoverUrl'>
  album: AlbumSummary
}

/** An album as a card: its cover, its title, and its artists under it. */
export const albumCard = ({ api, headersFor, album }: AlbumCardProps): ShelfCard => ({
  key: `album:${album.id}`,
  title: album.title,
  line: artistNames(album),
  shape: CARD_SHAPES.poster,
  picture: pictureAt({
    uri: api.albumCoverUrl({ albumId: album.id, coverVersion: album.coverVersion }),
    headersFor,
  }),
  progress: 0,
  target: { kind: ROUTE_TARGETS.album, albumId: album.id },
})

const SECTION_KEYS = { albums: 'albums', appearsOn: 'appearsOn' } as const

const APPEARS_ON = 'Appears on'

type AlbumSectionsOfProps = Pick<AlbumCardProps, 'api' | 'headersFor'> & {
  albums: readonly AlbumSummary[]
}

/** A music library's one run of cards: its albums in the order listed. */
export const albumSectionsOf = ({
  api,
  headersFor,
  albums,
}: AlbumSectionsOfProps): GridSection[] =>
  albums.length === 0
    ? []
    : [
        {
          key: SECTION_KEYS.albums,
          title: null,
          count: null,
          shape: CARD_SHAPES.poster,
          cards: albums.map((album) => albumCard({ api, headersFor, album })),
        },
      ]

type ArtistSectionsOfProps = AlbumSectionsOfProps & { appearsOn: readonly AlbumSummary[] }

/**
 * An artist's page as a grid: their own albums open, then the albums of others they appear on,
 * as a bucket folded until opened, as the web's sections are.
 */
export const artistSectionsOf = ({
  api,
  headersFor,
  albums,
  appearsOn,
}: ArtistSectionsOfProps): GridSection[] => [
  ...albumSectionsOf({ api, headersFor, albums }),
  ...(appearsOn.length === 0
    ? []
    : [
        {
          key: SECTION_KEYS.appearsOn,
          title: APPEARS_ON,
          count: String(appearsOn.length),
          shape: CARD_SHAPES.poster,
          cards: appearsOn.map((album) => albumCard({ api, headersFor, album })),
        },
      ]),
]

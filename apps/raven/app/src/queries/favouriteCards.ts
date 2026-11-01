import {
  type AlbumSummary,
  type ApiClient,
  type Artist,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemSummary,
  type PosterEntry,
} from '@raven/core'

import { albumCard, artistCard } from '@/music/musicCards'
import {
  CARD_SHAPES,
  type Pictures,
  type ShelfCard,
  frameCard,
  imageOf,
  pictureAt,
} from '@/queries/cards'
import { continueCard } from '@/queries/homeShelves'
import type { GridSection } from '@/queries/libraryGrid'
import { type ShowArts, logoOf } from '@/queries/showArt'
import { itemTarget } from '@/routes'

/** The runs a favourites page has, in the order they are laid out. */
const SECTION_KEYS = {
  titles: 'titles',
  wide: 'wide',
  frames: 'frames',
  albums: 'albums',
  artists: 'artists',
} as const

type TitleCardProps = Pictures & { item: ItemSummary; arts: ShowArts }

/** The art of the show or film `item` wears: an episode or season wears its show's. */
const artOfItem = ({ item, arts }: Pick<TitleCardProps, 'item' | 'arts'>) =>
  arts.get(item.show?.id ?? item.id) ?? null

/**
 * A favourite show or season: where its show has a backdrop, a wide card with the logo over it,
 * as Continue watching's; else its poster, a season under the show it
 * belongs to.
 */
const titleCard = ({ item, arts, api, headersFor }: TitleCardProps): ShelfCard => {
  const art = artOfItem({ item, arts })
  const base = {
    key: `title:${item.id}`,
    title: item.title,
    line: item.show?.title ?? (item.year === null ? null : String(item.year)),
    progress: 0,
    target: itemTarget(item.id),
  }
  if (art !== null && art.backdrop !== null) {
    return {
      ...base,
      shape: CARD_SHAPES.wide,
      picture: art.backdrop,
      logo: art.logo,
      resume: { timeLeft: null },
    }
  }
  return {
    ...base,
    shape: CARD_SHAPES.poster,
    picture: pictureAt({
      uri: imageOf({ api, item, kind: ITEM_IMAGE_KINDS.poster }),
      headersFor,
    }),
    logo: art?.logo ?? null,
  }
}

/** Whether a favourite title is drawn wide: its show has a backdrop. */
const isWideTitle = ({ item, arts }: Pick<TitleCardProps, 'item' | 'arts'>): boolean =>
  (artOfItem({ item, arts })?.backdrop ?? null) !== null

type WithLogoProps = { card: ShelfCard; entry: PosterEntry; arts: ShowArts }

const withLogo = ({ card, entry, arts }: WithLogoProps): ShelfCard => ({
  ...card,
  logo: logoOf({ entry, arts }),
})

const isEpisode = ({ media }: PosterEntry): boolean => media.item?.type === ITEM_TYPES.episode

const hasPoster = ({ poster }: PosterEntry): boolean => poster !== null

/** An episode, or a film with a poster: drawn as Continue watching's card, on its backdrop. */
const isWideVideo = (entry: PosterEntry): boolean => isEpisode(entry) || hasPoster(entry)

type RunOfProps = { key: string; shape: GridSection['shape']; cards: ShelfCard[] }

/** One open, untitled run of cards, or none when there are no cards. */
const runOf = ({ key, shape, cards }: RunOfProps): GridSection[] =>
  cards.length === 0 ? [] : [{ key, title: null, count: null, shape, cards }]

type FavouriteSectionsOfProps = Pick<Pictures, 'headersFor'> & {
  api: Pictures['api'] & Pick<ApiClient, 'albumCoverUrl'>
  titles: readonly ItemSummary[]
  videos: readonly PosterEntry[]
  albums: readonly AlbumSummary[]
  artists: readonly Artist[]
  /** The art of the shows and films, as `useShowArts` reads it: albums and artists have none. */
  arts: ShowArts
}

/**
 * Every favourite as the web's Favourites page lays them out: shows and seasons as posters only
 * where they have no backdrop, then the wide run in Continue watching's style (shows, seasons,
 * films and episodes over their backdrop with their logo), frames for the rest, the albums and the
 * artists, each most recently marked first as the server lists them. Every run is open.
 */
export const favouriteSectionsOf = ({
  titles,
  videos,
  albums,
  artists,
  arts,
  api,
  headersFor,
}: FavouriteSectionsOfProps): GridSection[] => {
  const pictures = { api, headersFor }
  const wideTitles = titles.filter((item) => isWideTitle({ item, arts }))
  const posterTitles = titles.filter((item) => !isWideTitle({ item, arts }))
  return [
    ...runOf({
      key: SECTION_KEYS.titles,
      shape: CARD_SHAPES.poster,
      cards: posterTitles.map((item) => titleCard({ item, arts, ...pictures })),
    }),
    ...runOf({
      key: SECTION_KEYS.wide,
      shape: CARD_SHAPES.wide,
      cards: [
        ...wideTitles.map((item) => titleCard({ item, arts, ...pictures })),
        ...videos.filter(isWideVideo).map((entry) => continueCard({ entry, arts, ...pictures })),
      ],
    }),
    ...runOf({
      key: SECTION_KEYS.frames,
      shape: CARD_SHAPES.wide,
      cards: videos
        .filter((entry) => !isWideVideo(entry))
        .map((entry) =>
          withLogo({ card: frameCard({ media: entry.media, ...pictures }), entry, arts }),
        ),
    }),
    ...runOf({
      key: SECTION_KEYS.albums,
      shape: CARD_SHAPES.poster,
      cards: albums.map((album) => albumCard({ album, ...pictures })),
    }),
    ...runOf({
      key: SECTION_KEYS.artists,
      shape: CARD_SHAPES.poster,
      cards: artists.map((artist) => artistCard({ artist })),
    }),
  ]
}

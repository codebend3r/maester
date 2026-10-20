import {
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  type MediaTracks,
  allFileFacts,
  castMembers,
  createdBy,
  directedBy,
  episodeByline,
  episodeEntryKey,
  episodeFacts,
  episodeRowFacts,
  episodeStillUrl,
  episodesOf,
  episodesWatched,
  initialsOf,
  movieFacts,
  plural,
  progressOf,
  seasonEntryKey,
  seasonFacts,
  seasonsOf,
  showFacts,
  timeLeftOf,
  versionFacts,
  watchedCountLabel,
} from '@raven/core'

import {
  CARD_SHAPES,
  type CardShape,
  type Picture,
  type Pictures,
  type ShelfCard,
  imageOf,
  pictureAt,
} from '@/queries/cards'
import { ROUTE_TARGETS, type RouteTarget, itemTarget } from '@/routes'

/** How far through something the viewer is, and what that is in words. */
type Progress = { fraction: number; label: string }

/** What heads an item's page: its pictures, its names and its facts. */
export type ItemHero = {
  /** The small line over the title: "Show", or an episode's show and number. */
  eyebrow: string | null
  title: string
  byline: string | null
  /** The content rating, "R". */
  rating: string | null
  facts: string[]
  progress: Progress | null
  /** A movie's, show's or season's poster, or an episode's still. */
  poster: { shape: CardShape; picture: Picture | null }
  backdrop: Picture | null
  tagline: string | null
  summary: string | null
}

/** One person in the cast and crew: their roles, and their photo or initials. */
export type PersonCard = {
  key: string
  name: string
  role: string
  initials: string
  picture: Picture | null
}

/** One of a movie's files, with what sets it apart, playing on its own. */
export type VersionRow = { key: string; fileName: string; facts: string[]; target: RouteTarget }

/** One episode on disk: its card, and what its row adds to it. */
export type EpisodeRow = ShelfCard & { summary: string | null; isWatched: boolean }

/** Everything an item's page shows but its actions, which are the screen's. */
export type ItemPage = {
  hero: ItemHero
  /** The file Play starts, as label and value; none for a show or season. */
  file: Array<{ label: string; value: string }>
  /** A movie's files, once there are two or more. */
  versions: VersionRow[]
  seasons: ShelfCard[]
  episodes: EpisodeRow[]
  castTitle: string
  cast: PersonCard[]
}

const CAST_TITLES = { everyone: 'Cast & Crew', guests: 'Guest stars & crew' } as const

const castOf = ({ details, api, headersFor }: Pictures & { details: ItemDetails }) =>
  castMembers(details.credits).map((member): PersonCard => ({
    key: String(member.personId),
    name: member.name,
    role: member.roles.join(' / '),
    initials: initialsOf(member.name),
    picture: pictureAt({ uri: api.photoUrl(member), headersFor }),
  }))

const posterOf = ({ details, api, headersFor }: Pictures & { details: ItemDetails }) => ({
  shape: CARD_SHAPES.poster,
  picture: pictureAt({
    uri: imageOf({ api, item: details, kind: ITEM_IMAGE_KINDS.poster }),
    headersFor,
  }),
})

const backdropOf = ({
  details,
  api,
  headersFor,
}: Pictures & { details: ItemDetails | null }): Picture | null =>
  pictureAt({ uri: imageOf({ api, item: details, kind: ITEM_IMAGE_KINDS.backdrop }), headersFor })

/** How much of a video started is left, with its line; nothing for one not started. */
const timeLeft = (media: MediaItem): Progress | null => {
  const label = timeLeftOf(media)
  return label === null ? null : { fraction: progressOf(media), label }
}

const pageOf = ({
  hero,
  details,
  ...rest
}: Pictures &
  Partial<Omit<ItemPage, 'hero' | 'cast'>> & { hero: ItemHero; details: ItemDetails }) => ({
  hero,
  file: rest.file ?? [],
  versions: rest.versions ?? [],
  seasons: rest.seasons ?? [],
  episodes: rest.episodes ?? [],
  castTitle: rest.castTitle ?? CAST_TITLES.everyone,
  cast: castOf({ details, ...rest }),
})

/**
 * A movie's or an episode's page, for the files of the one library and card it shows:
 * `versions`, and `primary`, the one Play starts. An episode is headed by its still under its
 * show's backdrop, which waits for `show` to be read, and its show and number; a movie by its
 * poster, backdrop and director. Either says how much of `primary` is left.
 */
export const playablePage = ({
  kind,
  details,
  versions,
  primary,
  show,
  tracks,
  ...pictures
}: Pictures & {
  kind: typeof ITEM_TYPES.movie | typeof ITEM_TYPES.episode
  details: ItemDetails
  versions: MediaItem[]
  primary: MediaItem
  show: ItemDetails | null
  tracks: MediaTracks | undefined
}): ItemPage => {
  const isEpisode = kind === ITEM_TYPES.episode
  const shown = { ...details, versions }
  const still = pictureAt({
    uri:
      pictures.api.itemImageUrl({
        id: details.id,
        kind: ITEM_IMAGE_KINDS.still,
        version: details.backdropVersion,
      }) ?? pictures.api.thumbnailUrl(primary),
    headersFor: pictures.headersFor,
  })
  const hero: ItemHero = {
    eyebrow: isEpisode ? episodeByline(details) || null : null,
    title: details.title,
    byline: isEpisode ? null : directedBy(details),
    rating: isEpisode ? null : details.contentRating,
    facts: isEpisode
      ? episodeFacts({ details: shown, primary })
      : movieFacts({ details: shown, primary }),
    progress: timeLeft(primary),
    poster: isEpisode
      ? { shape: CARD_SHAPES.wide, picture: still }
      : posterOf({ details, ...pictures }),
    // The still stands in only for a show with no backdrop, not while the show is read.
    backdrop: isEpisode
      ? show === null
        ? null
        : (backdropOf({ details: show, ...pictures }) ?? still)
      : backdropOf({ details, ...pictures }),
    tagline: isEpisode ? null : details.tagline,
    summary: details.summary,
  }
  return pageOf({
    hero,
    details,
    file: allFileFacts({ media: primary, tracks }),
    versions:
      versions.length < 2
        ? []
        : versions.map((version) => ({
            key: String(version.id),
            fileName: version.fileName,
            facts: [...versionFacts(version), version.edition].filter(
              (fact): fact is string => fact !== null && fact !== '',
            ),
            target: { kind: ROUTE_TARGETS.play, mediaId: version.id },
          })),
    castTitle: isEpisode ? CAST_TITLES.guests : CAST_TITLES.everyone,
    ...pictures,
  })
}

/** A show's page: its poster and backdrop, creator, years and network, then its seasons. */
export const showPage = ({ details, ...pictures }: Pictures & { details: ItemDetails }): ItemPage =>
  pageOf({
    hero: {
      eyebrow: 'Show',
      title: details.title,
      byline: createdBy(details),
      rating: details.contentRating,
      facts: showFacts(details),
      progress: null,
      poster: posterOf({ details, ...pictures }),
      backdrop: backdropOf({ details, ...pictures }),
      tagline: details.tagline,
      summary: details.summary,
    },
    details,
    seasons: seasonsOf(details).map((season): ShelfCard => ({
      key: seasonEntryKey(season),
      title: season.title,
      line: plural({ n: season.episodeCount, one: 'episode', many: 'episodes' }),
      shape: CARD_SHAPES.poster,
      picture: pictureAt({
        uri: imageOf({ ...pictures, item: season, kind: ITEM_IMAGE_KINDS.poster }),
        headersFor: pictures.headersFor,
      }),
      progress: 0,
      target: itemTarget(season.id),
    })),
    ...pictures,
  })

/**
 * A season's page: its poster under its show's backdrop, which waits for `show` to be read,
 * how much of it is watched, then its episodes on disk in order, each opening its page in the
 * library of the file it plays.
 */
export const seasonPage = ({
  season,
  show,
  ...pictures
}: Pictures & { season: ItemDetails; show: ItemDetails | null }): ItemPage => {
  const episodes = episodesOf(season)
  const { watched, total } = episodesWatched(episodes)
  return pageOf({
    hero: {
      eyebrow: season.show?.title ?? null,
      title: season.title,
      byline: null,
      rating: show?.contentRating ?? null,
      facts: seasonFacts(season),
      progress:
        total === 0
          ? null
          : { fraction: watched / total, label: watchedCountLabel({ watched, total }) },
      poster: posterOf({ details: season, ...pictures }),
      backdrop: backdropOf({ details: show, ...pictures }),
      tagline: null,
      summary: season.summary,
    },
    details: season,
    episodes: episodes.map((episode): EpisodeRow => ({
      key: episodeEntryKey(episode),
      title: [episode.episode === null ? null : `E${episode.episode}`, episode.title]
        .filter((part): part is string => part !== null)
        .join(' · '),
      line: episodeRowFacts(episode).join(' · ') || null,
      shape: CARD_SHAPES.wide,
      picture: pictureAt({
        uri: episodeStillUrl({ ...pictures, episode }),
        headersFor: pictures.headersFor,
      }),
      progress: episode.primary === null ? 0 : progressOf(episode.primary),
      target: {
        kind: ROUTE_TARGETS.item,
        itemId: episode.id,
        libraryId: episode.primary?.libraryId ?? null,
        fileId: null,
      },
      summary: episode.summary,
      isWatched: episode.watched,
    })),
    ...pictures,
  })
}

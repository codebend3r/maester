import {
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  type MediaTracks,
  allFileFacts,
  type FileFact,
  castMembers,
  createdBy,
  directedBy,
  episodeEntryKey,
  episodeFacts,
  episodeRowFacts,
  episodeStillUrl,
  episodesOf,
  episodesWatched,
  initialsOf,
  movieFacts,
  picturesIn,
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
import { episodeMarkOf } from '@/queries/episodeMark'
import { ROUTE_TARGETS, type RouteTarget, itemTarget } from '@/routes'

/** How far through something the viewer is, and what that is in words. */
type Progress = { fraction: number; label: string }

/** Where a page's title art stands: over the eyebrow (an episode's or a season's show), or in the title's own place (a show's or a film's own). */
export const ART_PLACES = { over: 'over', title: 'title' } as const

type ArtPlace = (typeof ART_PLACES)[keyof typeof ART_PLACES]

/** A page's title art and where it stands. */
type TitleArtOf = { picture: Picture; place: ArtPlace }

/** What heads an item's page: its pictures, its names and its facts. */
export type ItemHero = {
  /** The small line over the title: "Show", or an episode's show and place; its show's name is left to `logo` where there is art. */
  eyebrow: string | null
  /** The title art: an episode's or a season's show's over the eyebrow, a show's or a film's own in the title's place. */
  logo: TitleArtOf | null
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
  /** The file Play starts, as its facts; none for a show or season. */
  file: FileFact[]
  /** A movie's files, once there are two or more. */
  versions: VersionRow[]
  seasons: ShelfCard[]
  episodes: EpisodeRow[]
  castTitle: string
  cast: PersonCard[]
}

const CAST_TITLES = { everyone: 'Cast & Crew', guests: 'Guest stars & crew' } as const

/** An item and where its pictures come from. */
type DetailsProps = Pictures & { details: ItemDetails }

type CastOfProps = DetailsProps

const castOf = ({ details, api, headersFor }: CastOfProps) =>
  castMembers(details.credits).map((member): PersonCard => ({
    key: String(member.personId),
    name: member.name,
    role: member.roles.join(' / '),
    initials: initialsOf(member.name),
    picture: pictureAt({ uri: api.photoUrl(member), headersFor }),
  }))

type PosterOfProps = DetailsProps

const posterOf = ({ details, api, headersFor }: PosterOfProps) => ({
  shape: CARD_SHAPES.poster,
  picture: pictureAt({
    uri: imageOf({ api, item: details, kind: ITEM_IMAGE_KINDS.poster }),
    headersFor,
  }),
})

type LogoOfProps = Pictures & { details: ItemDetails | null; place: ArtPlace }

/** An item's title art, at `place`, or null while it has none or the item is unknown. */
const logoOf = ({ details, place, api, headersFor }: LogoOfProps): TitleArtOf | null => {
  const version = details?.logoVersion ?? null
  if (details === null || version === null) return null
  const picture = pictureAt({
    uri: api.itemImageUrl({ id: details.id, kind: ITEM_IMAGE_KINDS.logo, version }),
    headersFor,
  })
  return picture === null ? null : { picture, place }
}

type BackdropOfProps = Pictures & { details: ItemDetails | null }

const backdropOf = ({ details, api, headersFor }: BackdropOfProps): Picture | null =>
  pictureAt({ uri: imageOf({ api, item: details, kind: ITEM_IMAGE_KINDS.backdrop }), headersFor })

/** A line of facts, or null when it has none to say. */
const lineOrNull = (line: string): string | null => (line === '' ? null : line)

/** How much of a video started is left, with its line; nothing for one not started. */
const timeLeft = (media: MediaItem): Progress | null => {
  const label = timeLeftOf(media)
  return label === null ? null : { fraction: progressOf(media), label }
}

type PageOfProps = DetailsProps & Partial<Omit<ItemPage, 'hero' | 'cast'>> & { hero: ItemHero }

const pageOf = ({ hero, details, ...rest }: PageOfProps) => ({
  hero,
  file: rest.file ?? [],
  versions: rest.versions ?? [],
  seasons: rest.seasons ?? [],
  episodes: rest.episodes ?? [],
  castTitle: rest.castTitle ?? CAST_TITLES.everyone,
  cast: castOf({ details, ...rest }),
})

/** A playable item, the details as the one library shows them (`shown`) and the file Play starts. */
type PlayableHeroProps = DetailsProps & { shown: ItemDetails; primary: MediaItem }

type MovieHeroProps = PlayableHeroProps

/** A movie's heading: its title art in its name's place, its poster and backdrop, director, rating and facts. */
const movieHero = ({ details, shown, primary, ...pictures }: MovieHeroProps): ItemHero => ({
  eyebrow: null,
  title: details.title,
  byline: directedBy(details),
  rating: details.contentRating,
  facts: movieFacts({ details: shown, primary }),
  logo: logoOf({ details, place: ART_PLACES.title, ...pictures }),
  progress: timeLeft(primary),
  poster: posterOf({ details, ...pictures }),
  backdrop: backdropOf({ details, ...pictures }),
  tagline: details.tagline,
  summary: details.summary,
})

type EpisodeHeroProps = PlayableHeroProps & {
  /** An episode's show, once read; null while it is read, when it cannot be, and for a movie. */
  show: ItemDetails | null
  /** Whether an episode's show is still being read. */
  isShowPending: boolean
}

/**
 * An episode's heading: its still, else a frame of its file, under its show's backdrop, its
 * show's title art over its place in short ("S02 · E05"), or its show's name there while it
 * has no art. The still stands in for a show with no backdrop, or one that could not be read,
 * but not while the show is still being read.
 */
const episodeHero = ({
  details,
  shown,
  primary,
  show,
  isShowPending,
  ...pictures
}: EpisodeHeroProps): ItemHero => {
  const still = pictureAt({
    uri:
      pictures.api.itemImageUrl({
        id: details.id,
        kind: ITEM_IMAGE_KINDS.still,
        version: details.backdropVersion,
      }) ?? pictures.api.thumbnailUrl(primary),
    headersFor: pictures.headersFor,
  })
  const logo = logoOf({ details: show, place: ART_PLACES.over, ...pictures })
  const mark = episodeMarkOf({ season: details.season, episode: details.episode })
  return {
    eyebrow: lineOrNull(
      [logo === null ? (details.show?.title ?? null) : null, mark]
        .filter((part): part is string => part !== null)
        .join(' · '),
    ),
    logo,
    title: details.title,
    byline: null,
    rating: null,
    facts: episodeFacts({ details: shown, primary }),
    progress: timeLeft(primary),
    poster: { shape: CARD_SHAPES.wide, picture: still },
    backdrop: isShowPending ? null : (backdropOf({ details: show, ...pictures }) ?? still),
    tagline: null,
    summary: details.summary,
  }
}

type PlayablePageProps = Omit<EpisodeHeroProps, 'shown'> & {
  kind: typeof ITEM_TYPES.movie | typeof ITEM_TYPES.episode
  versions: MediaItem[]
  tracks: MediaTracks | undefined
}

/**
 * A movie's or an episode's page, for the files of the one library and card it shows:
 * `versions`, and `primary`, the one Play starts. Either says how much of `primary` is left.
 */
export const playablePage = ({
  kind,
  details,
  versions,
  primary,
  show,
  isShowPending,
  tracks,
  ...pictures
}: PlayablePageProps): ItemPage => {
  const isEpisode = kind === ITEM_TYPES.episode
  const shown = { ...details, versions }
  // Each library holding the item can choose its own pictures.
  const pictured = picturesIn({ details, libraryId: primary.libraryId })
  const showPictured =
    show === null ? null : picturesIn({ details: show, libraryId: primary.libraryId })
  const hero = isEpisode
    ? episodeHero({
        details: pictured,
        shown,
        primary,
        show: showPictured,
        isShowPending,
        ...pictures,
      })
    : movieHero({ details: pictured, shown, primary, ...pictures })
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
            target: { kind: ROUTE_TARGETS.play, mediaId: version.id, at: 0 },
          })),
    castTitle: isEpisode ? CAST_TITLES.guests : CAST_TITLES.everyone,
    ...pictures,
  })
}

type ShowPageProps = DetailsProps

/** A show's page: its title art in its name's place, poster and backdrop, creator, years and network, then its seasons. */
export const showPage = ({ details, ...pictures }: ShowPageProps): ItemPage =>
  pageOf({
    hero: {
      eyebrow: 'Show',
      logo: logoOf({ details, place: ART_PLACES.title, ...pictures }),
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

type SeasonPageProps = Pictures & { season: ItemDetails; show: ItemDetails | null }

/**
 * A season's page: its poster under its show's backdrop, which waits for `show` to be read,
 * how much of it is watched, then its episodes on disk in order, each opening its page in the
 * library of the file it plays.
 */
export const seasonPage = ({ season, show, ...pictures }: SeasonPageProps): ItemPage => {
  const episodes = episodesOf(season)
  const { watched, total } = episodesWatched(episodes)
  return pageOf({
    hero: {
      eyebrow: season.show?.title ?? null,
      logo: logoOf({ details: show, place: ART_PLACES.over, ...pictures }),
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
      line: lineOrNull(episodeRowFacts(episode).join(' · ')),
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

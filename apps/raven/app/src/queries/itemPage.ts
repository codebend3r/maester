import {
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  type MediaTracks,
  type Rating,
  FACT_PART_KINDS,
  type FactPart,
  type FileFact,
  allFileFacts,
  castMembers,
  createdBy,
  directedBy,
  episodeEntryKey,
  episodeFacts,
  episodeRowFacts,
  episodeStillUrl,
  episodesOf,
  episodesWatched,
  factParts,
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
  wordPart,
  episodeTag,
} from '@raven/core'

import {
  CARD_SHAPES,
  CARD_SUBJECTS,
  isAllWatched,
  type CardShape,
  type Picture,
  type Pictures,
  type ShelfCard,
  imageOf,
  pictureAt,
} from '@/queries/cards'
import { ITEM_PAGE_COPY } from '@/queries/copy'
import { ROUTE_TARGETS, type RouteTarget, itemTarget } from '@/routes'

/** How far through something the viewer is, and what that is in words. */
type Progress = { fraction: number; label: string }

/** Where a page's title art stands: over the eyebrow (an episode's or a season's show), or in the title's own place (a show's or a film's own). */
export const ART_PLACES = { over: 'over', title: 'title' } as const

type ArtPlace = (typeof ART_PLACES)[keyof typeof ART_PLACES]

/** A page's title art and where it stands. */
type TitleArtOf = { picture: Picture; place: ArtPlace }

/** The page the title art or the name over an episode or a season leads back to: its show. */
type HeroHome = { target: RouteTarget; name: string }

/** An episode's or a season's way back to its show; null for one that names no show. */
const heroHomeOf = (show: ItemDetails['show']): HeroHome | null =>
  show === null ? null : { target: itemTarget(show.id), name: show.title }

/** What heads an item's page: its pictures, its names and its facts. */
export type ItemHero = {
  /** The small line over the title: "Show", or an episode's show and place; its show's name is left to `logo` where there is art. */
  eyebrow: string | null
  /** The title art: an episode's or a season's show's over the eyebrow, a show's or a film's own in the title's place. */
  logo: TitleArtOf | null
  /** Where the art over the eyebrow, or the show's name there, leads: an episode's or a season's show; null on a show's or a film's own page. */
  home: HeroHome | null
  title: string
  byline: string | null
  /** The content rating, "R". */
  rating: string | null
  /** Every score it has, one per source, as the web's ratings panel shows them; none for a season. */
  ratings: readonly Rating[]
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

/**
 * One of a movie's files, with what sets it apart, playing on its own: its picture as chips (its
 * resolution, range and codec), then the rest in words (its size, edition and library).
 */
export type VersionRow = {
  key: string
  fileName: string
  chips: FactPart[]
  facts: string[]
  target: RouteTarget
}

/** One of the file's facts as the page draws it: its label, the picture's chips, and the rest in words. */
type FileFactRow = { label: string; chips: FactPart[]; values: string[] }

/** One episode on disk: its card, and what its row adds to it. */
export type EpisodeRow = ShelfCard & {
  summary: string | null
  isWatched: boolean
  chips: readonly FactPart[]
}

/** Everything an item's page shows but its actions, which are the screen's. */
export type ItemPage = {
  hero: ItemHero
  /** The file Play starts, as its facts; none for a show or season. */
  file: FileFactRow[]
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

type ChipsAndWords = { chips: FactPart[]; words: string[] }

/** The parts the page draws as chips (a resolution, codec or range), apart from the words. */
const chipsAndWords = (parts: readonly FactPart[]): ChipsAndWords => ({
  chips: parts.filter((part) => part.kind !== FACT_PART_KINDS.text),
  words: parts.flatMap((part) => (part.kind === FACT_PART_KINDS.text ? [part.text] : [])),
})

/** A file's fact with its picture marked as chips: the Video fact's `4K (HEVC) HDR`. */
const fileFactRow = ({ label, values }: FileFact): FileFactRow => {
  const { chips, words } = chipsAndWords(values.flatMap(factParts))
  return { label, chips, values: words }
}

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
  home: null,
  title: details.title,
  byline: directedBy(details),
  rating: details.contentRating,
  ratings: details.ratings,
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
  const mark = episodeTag({ season: details.season, episode: details.episode })
  return {
    eyebrow: lineOrNull(
      [logo === null ? (details.show?.title ?? null) : null, mark]
        .filter((part): part is string => part !== null)
        .join(' · '),
    ),
    logo,
    home: heroHomeOf(details.show),
    title: details.title,
    byline: null,
    rating: null,
    ratings: details.ratings,
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
  /** Every file of the item in every library the viewer sees, each a row to play it by. */
  everyFile: MediaItem[]
  /** The libraries' names by id, for rows that come from more than one. */
  libraryNames: ReadonlyMap<number, string>
  tracks: MediaTracks | undefined
}

type VersionRowsOfProps = Pick<PlayablePageProps, 'everyFile' | 'libraryNames'>

/**
 * A row for each file of the item, in every library, once it has two or more: each plays its own
 * file, and names its library when they come from more than one (a 4K copy beside a 1080p one).
 */
const versionRowsOf = ({ everyFile, libraryNames }: VersionRowsOfProps): VersionRow[] => {
  if (everyFile.length < 2) return []
  const isAcrossLibraries = new Set(everyFile.map(({ libraryId }) => libraryId)).size > 1
  return everyFile.map((version) => {
    const { chips, words } = chipsAndWords(versionFacts(version).map(wordPart))
    return {
      key: String(version.id),
      fileName: version.fileName,
      chips,
      facts: [
        ...words,
        version.edition,
        isAcrossLibraries ? (libraryNames.get(version.libraryId) ?? null) : null,
      ].filter((fact): fact is string => fact !== null && fact !== ''),
      target: { kind: ROUTE_TARGETS.play, mediaId: version.id, at: 0 },
    }
  })
}

/**
 * A movie's or an episode's page, for the files of the one library and card it shows:
 * `versions`, and `primary`, the one Play starts, with a row for every file it has anywhere.
 * Either says how much of `primary` is left.
 */
export const playablePage = ({
  kind,
  details,
  versions,
  everyFile,
  libraryNames,
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
    file: allFileFacts({ media: primary, tracks }).map(fileFactRow),
    versions: versionRowsOf({ everyFile, libraryNames }),
    castTitle: isEpisode ? CAST_TITLES.guests : CAST_TITLES.everyone,
    ...pictures,
  })
}

type ShowPageProps = DetailsProps

/** A show's page: its title art in its name's place, poster and backdrop, creator, years and network, then its seasons. */
export const showPage = ({ details, ...pictures }: ShowPageProps): ItemPage =>
  pageOf({
    hero: {
      eyebrow: ITEM_PAGE_COPY.show,
      logo: logoOf({ details, place: ART_PLACES.title, ...pictures }),
      home: null,
      title: details.title,
      byline: createdBy(details),
      rating: details.contentRating,
      ratings: details.ratings,
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
      line: plural({ n: season.episodeCount, ...ITEM_PAGE_COPY.episodes }),
      shape: CARD_SHAPES.poster,
      picture: pictureAt({
        uri: imageOf({ ...pictures, item: season, kind: ITEM_IMAGE_KINDS.poster }),
        headersFor: pictures.headersFor,
      }),
      progress: 0,
      subject: { kind: CARD_SUBJECTS.item, itemId: season.id },
      isWatched: isAllWatched({ watched: season.watchedCount, total: season.episodeCount }),
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
      home: heroHomeOf(season.show),
      title: season.title,
      byline: null,
      rating: show?.contentRating ?? null,
      ratings: [],
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
    episodes: episodes.map((episode): EpisodeRow => {
      const { chips, words } = chipsAndWords(episodeRowFacts(episode).map(wordPart))
      return {
        key: episodeEntryKey(episode),
        title: [
          episode.episode === null ? null : ITEM_PAGE_COPY.episodeNumber(episode.episode),
          episode.title,
        ]
          .filter((part): part is string => part !== null)
          .join(' · '),
        line: lineOrNull(words.join(' · ')),
        chips,
        shape: CARD_SHAPES.wide,
        picture: pictureAt({
          uri: episodeStillUrl({ ...pictures, episode }),
          headersFor: pictures.headersFor,
        }),
        progress: episode.primary === null ? 0 : progressOf(episode.primary),
        subject:
          episode.primary === null
            ? null
            : { kind: CARD_SUBJECTS.video, mediaId: episode.primary.id },
        target: {
          kind: ROUTE_TARGETS.item,
          itemId: episode.id,
          libraryId: episode.primary?.libraryId ?? null,
          fileId: null,
        },
        summary: episode.summary,
        isWatched: episode.watched,
      }
    }),
    ...pictures,
  })
}

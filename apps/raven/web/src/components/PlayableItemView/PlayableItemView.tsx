import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DOWNLOAD_TARGET_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type Library,
  type MatchItemType,
  type MediaItem,
  type MediaTracks,
  TITLE_DISPLAYS,
  WATCHED_STATES,
  directedBy,
  episodeBackPath,
  episodeNumberTag,
  seasonPath,
  seasonTag,
  showPath,
  episodeFacts,
  formatDuration,
  formatRuntime,
  inLibrary,
  itemPath,
  movieFacts,
  picturesIn,
  progressOf,
  watchLink,
  ITEM_IMAGE_KINDS,
  libraryPath,
} from '@raven/core'
import { type ComponentType, type ReactNode, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { BUTTON_TONES, ButtonLink } from '@raven/ui'
import type { BackFallback } from '@/components/BackButton/BackButton'
import { AiMatchNote } from '@/components/AiMatchNote/AiMatchNote'
import { CastRow } from '@/components/CastRow/CastRow'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import { HeroToggle } from '@/components/HeroToggle/HeroToggle'
import {
  type HeaderBackdrop,
  type HeaderProgress,
  ItemHeader,
  itemBackdrop,
  pictureBackdrop,
  PICTURE_SHAPES,
  ITEM_HEADER_VARIANTS,
} from '@/components/ItemHeader/ItemHeader'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { useItemEditors } from '@/components/ItemEditors/ItemEditors'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { EpisodeNeighbours } from '@/components/PlayableItemView/EpisodeNeighbours'
import { FileFacts } from '@/components/PlayableItemView/FileFacts'
import { SagaLink } from '@/components/SagaLink/SagaLink'
import { ReviewCards } from '@/components/ReviewCards/ReviewCards'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { Versions } from '@/components/Versions/Versions'
import { WatchedToggle } from '@/components/WatchedToggle/WatchedToggle'
import { api } from '@/lib/api'
import { displaySettingsQuery, itemQuery, librariesQuery, tracksQuery } from '@/lib/queries'
import { queryKeys } from '@raven/ui/headless'
import { useCanFavourite } from '@/lib/useCanFavourite'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { PLAYABLE_ITEM_VIEW_COPY } from '@/components/PlayableItemView/copy'
import styles from '@/components/PlayableItemView/PlayableItemView.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { handled } from '@/lib/handled'

type Facts = { details: ItemDetails; primary: MediaItem }

/** What a page's header shows of its pictures, as its config draws them. */
type HeaderPictures = Pick<Parameters<typeof ItemHeader>[0], 'picture' | 'backdrop' | 'variant'>

type HeaderPicturesProps = {
  details: ItemDetails
  /** The episode's still, else the file's frame grab. */
  still: string | null
  /** The show's backdrop under an episode, the still standing in for none. */
  episodeBackdrop: HeaderBackdrop | null
  play: NonNullable<HeaderPictures['picture']>['play']
}

type BackProps = Facts & { libraries: readonly Library[] }

type SagaSlotProps = { itemId: number; libraryId: number }

type ReviewsSlotProps = { reviews: ItemDetails['reviews'] }

/** What a page leaves out where the other kind shows something. */
const Nothing = () => null

/** How a movie's page and an episode's page differ; everything else they share. */
type PlayableConfig = {
  matchType: MatchItemType
  back: (facts: BackProps) => BackFallback
  /** The library linked above the title, where the way back does not already name it. */
  library: (back: BackFallback) => BackFallback | undefined
  /** The small line over the title: an episode's show and number. */
  eyebrow: (details: ItemDetails) => ReactNode[]
  byline: (details: ItemDetails) => string | null
  facts: (facts: Facts) => string[]
  tagline: (details: ItemDetails) => string | null
  contentRating: (details: ItemDetails) => string | null
  /** How far through the video the viewer is, where the header says so. */
  progress: (media: MediaItem) => HeaderProgress | undefined
  /** A movie has a poster and a backdrop; an episode its still under its show's backdrop. */
  pictures: (props: HeaderPicturesProps) => HeaderPictures
  /** Whether the page offers Edit images and Edit metadata, once the admin lock is off. */
  editable: boolean
  /** What follows the header: the file's facts, with the episodes either side for an episode. */
  About: ComponentType<AboutProps>
  /** The saga a movie is in, linked under the header. */
  Saga: ComponentType<SagaSlotProps>
  Reviews: ComponentType<ReviewsSlotProps>
  castTitle: string | undefined
}

/**
 * An episode's line over its title, "Lucky · S01 · E01": its show and its
 * season, each a link to that page, then its number. A part the episode does
 * not know is left out.
 */
const episodeEyebrow = ({ show, season, episode }: ItemDetails): ReactNode[] =>
  [
    show && (
      <Link key="show" to={showPath(show.id)} className={styles.eyebrowLink}>
        {show.title}
      </Link>
    ),
    show && season != null && (
      <Link
        key="season"
        to={seasonPath({ showId: show.id, season })}
        className={styles.eyebrowLink}
        aria-label={PLAYABLE_ITEM_VIEW_COPY.season(season)}
      >
        {seasonTag(season)}
      </Link>
    ),
    !show && season != null && seasonTag(season),
    episode != null && episodeNumberTag(episode),
  ].filter((part) => !!part)

/** How much of a video started is left, with its line; nothing for one not started. */
const timeLeft = (media: MediaItem): HeaderProgress | undefined => {
  const fraction = progressOf(media)
  const left = formatRuntime((media.duration ?? 0) - media.position)
  return fraction > 0 && left
    ? { fraction, label: PLAYABLE_ITEM_VIEW_COPY.timeLeft(left) }
    : undefined
}

type AboutProps = {
  details: ItemDetails
  primary: MediaItem
  tracks: MediaTracks | undefined
  tagline: string | null
  hasSummary: boolean
}

type AboutWithNeighboursProps = AboutProps

/** An episode's summary over its file's facts beside the episodes either side. */
const AboutWithNeighbours = ({ details, primary, tracks }: AboutWithNeighboursProps) => (
  <>
    <Summary tagline={null} summary={details.summary} />
    <div className={`${styles.about} ${styles.besides}`}>
      <FileFacts media={primary} tracks={tracks} className={styles.main} />
      <EpisodeNeighbours episode={details} libraryId={primary.libraryId} className={styles.aside} />
    </div>
  </>
)

type AboutAloneProps = AboutProps

/** A movie's tagline and summary beside its file's facts, or the facts alone. */
const AboutAlone = ({ details, primary, tracks, tagline, hasSummary }: AboutAloneProps) => (
  <div className={hasSummary ? `${styles.about} ${styles.besides}` : styles.about}>
    <Summary tagline={tagline} summary={details.summary} className={styles.main} />
    <FileFacts media={primary} tracks={tracks} className={hasSummary ? styles.aside : undefined} />
  </div>
)

const PLAYABLE = {
  [ITEM_TYPES.movie]: {
    matchType: ITEM_TYPES.movie,
    back: ({ primary, libraries }) => ({
      to: libraryPath(primary.libraryId),
      label: libraries.find((entry) => entry.id === primary.libraryId)?.name ?? COMMON_COPY.library,
    }),
    library: (back) => back,
    eyebrow: () => [],
    byline: directedBy,
    facts: movieFacts,
    tagline: (details) => details.tagline,
    contentRating: (details) => details.contentRating,
    progress: () => undefined,
    pictures: ({ details, play }) => ({
      picture: {
        shape: PICTURE_SHAPES.poster,
        url: api.itemImageUrl({
          id: details.id,
          kind: ITEM_IMAGE_KINDS.poster,
          version: details.posterVersion,
        }),
        play,
      },
      backdrop: itemBackdrop({ id: details.id, version: details.backdropVersion }),
      variant: ITEM_HEADER_VARIANTS.pulledUp,
    }),
    editable: true,
    About: AboutAlone,
    Saga: SagaLink,
    Reviews: ReviewCards,
    castTitle: undefined,
  },
  [ITEM_TYPES.episode]: {
    matchType: ITEM_TYPES.show,
    back: ({ details, primary }) => ({
      to: episodeBackPath({ item: details, libraryId: primary.libraryId }),
      label: details.show?.title ?? COMMON_COPY.library,
    }),
    library: () => undefined,
    eyebrow: (details) => episodeEyebrow(details),
    byline: () => null,
    facts: episodeFacts,
    tagline: () => null,
    contentRating: () => null,
    progress: (media) => timeLeft(media),
    pictures: ({ still, episodeBackdrop, play }) => ({
      picture: { shape: PICTURE_SHAPES.still, url: still, play },
      backdrop: episodeBackdrop,
      variant: ITEM_HEADER_VARIANTS.standard,
    }),
    editable: false,
    About: AboutWithNeighbours,
    Saga: Nothing,
    Reviews: Nothing,
    castTitle: PLAYABLE_ITEM_VIEW_COPY.guestStars,
  },
} as const satisfies Record<typeof ITEM_TYPES.movie | typeof ITEM_TYPES.episode, PlayableConfig>

type PlayableItemViewProps = {
  kind: keyof typeof PLAYABLE
  /** The item with every file this browser may see, in any library. */
  details: ItemDetails
  /** The files on the one card, in the one library, the page is for. */
  versions: MediaItem[]
  /** The item's files in that library, on every card. */
  everyCard: MediaItem[]
  primary: MediaItem
}

/**
 * A movie's or an episode's page once the item, the library's files it
 * shows and the version Play starts are known: the header with Play,
 * favourite and Watched, and with the admin lock off the editors and the
 * file's menu (its picture plays too), whether this browser cannot play
 * that version, then the summary beside the file's facts, its versions, an
 * episode's neighbours, the people, a movie's reviews and TMDB's credit.
 * The pictures are the library's, which Edit images chooses for it alone.
 */
export const PlayableItemView = ({
  kind,
  details: item,
  versions,
  everyCard,
  primary,
}: PlayableItemViewProps) => {
  // Each library holding the item can choose its own pictures.
  const details = { ...picturesIn({ details: item, libraryId: primary.libraryId }), versions }
  const config: PlayableConfig = PLAYABLE[kind]
  const titleId = useId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const { favourite, watched } = useMediaMutations({ media: primary })
  // A locked library's videos are never marked, but one marked before it locked can be unmarked.
  const canFavourite = useCanFavourite(primary.libraryId) || primary.favourite
  const libraries = useQuery(librariesQuery)
  const tracks = useQuery(tracksQuery(primary.id))
  // The neighbours read the show too, so the backdrop costs no request of its own.
  const show = useQuery(itemQuery(item.show?.id ?? null))
  // A logo until Settings says to spell titles out, as a fresh install does.
  const showsLogo = (useQuery(displaySettingsQuery).data?.titles ?? null) !== TITLE_DISPLAYS.text
  const known = libraries.data ?? []
  const editors = useItemEditors({
    images: { details: item, libraries: known, libraryId: primary.libraryId },
    metadata: { details, everyCard, itemKind: ITEM_TYPES.movie },
  })
  const back = config.back({ details, primary, libraries: known })
  const tagline = config.tagline(details)
  const play = watchLink({ media: primary })
  const playPicture = { ...play, label: PLAYABLE_ITEM_VIEW_COPY.playTitle(details.title) }
  const still =
    api.itemImageUrl({
      id: details.id,
      kind: ITEM_IMAGE_KINDS.still,
      version: details.backdropVersion,
    }) ?? api.thumbnailUrl(primary)
  const showBackdrop = show.data
    ? itemBackdrop({
        id: show.data.id,
        version: picturesIn({ details: show.data, libraryId: primary.libraryId }).backdropVersion,
      })
    : null
  // The still stands in only for a show with no backdrop, not while the show is read.
  const episodeBackdrop =
    item.show && show.isPending ? null : (showBackdrop ?? pictureBackdrop(still))
  const hasSummary = !!tagline || !!details.summary
  const { About, Saga, Reviews } = config

  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <ItemHeader
        back={back}
        library={config.library(back)}
        titleId={titleId}
        eyebrow={config.eyebrow(details)}
        title={details.title}
        byline={config.byline(details)}
        contentRating={config.contentRating(details)}
        facts={config.facts({ details, primary })}
        ratings={details.ratings}
        progress={config.progress(primary)}
        logo={
          showsLogo
            ? api.itemImageUrl({
                id: details.id,
                kind: ITEM_IMAGE_KINDS.logo,
                version: details.logoVersion,
              })
            : null
        }
        {...config.pictures({ details, still, episodeBackdrop, play: playPicture })}
        manage={
          <AdminOnly>
            {config.editable && editors.buttons}
            {details.type === ITEM_TYPES.movie && <HeroToggle itemId={details.id} />}
            {/* Without its favourite and watched, which the page has beside it, all the menu holds needs the admin lock off. */}
            <MediaMenu
              media={primary}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              inline
              matchType={config.matchType}
              aiMatch={details.aiMatch}
              withFavourite={false}
              withWatched={false}
              onMatched={(updated) => {
                const page = updated.item ? itemPath(updated.item) : null
                navigate(
                  page == null
                    ? libraryPath(updated.libraryId)
                    : inLibrary({ page, libraryId: updated.libraryId }),
                  { replace: true },
                )
              }}
              onDeleted={() => {
                if (details.versions.length <= 1) navigate(back.to)
                else
                  handled(queryClient.invalidateQueries({ queryKey: queryKeys.item(details.id) }))
              }}
            />
          </AdminOnly>
        }
      >
        <ButtonLink tone={BUTTON_TONES.primary} icon="play" to={play.to} state={play.state}>
          {primary.position > 0
            ? PLAYABLE_ITEM_VIEW_COPY.resumeFrom(formatDuration(primary.position))
            : COMMON_COPY.play}
        </ButtonLink>
        <DownloadButton
          target={{ kind: DOWNLOAD_TARGET_KINDS.media, mediaId: primary.id }}
          isDolbyVisionOnly={primary.isDolbyVisionOnly}
        />
        {canFavourite && (
          <FavouriteButton isFavourite={primary.favourite} onToggle={favourite.mutate} />
        )}
        <WatchedToggle
          state={primary.watched ? WATCHED_STATES.watched : WATCHED_STATES.unwatched}
          onToggle={() => watched.mutate(!primary.watched)}
        />
      </ItemHeader>

      <PlaybackNote media={primary} />

      {details.aiMatch && <AiMatchNote aiMatch={details.aiMatch} />}

      <Saga itemId={details.id} libraryId={primary.libraryId} />

      <AdminOnly>{config.editable && editors.modal}</AdminOnly>

      <About
        details={details}
        primary={primary}
        tracks={tracks.data}
        tagline={tagline}
        hasSummary={hasSummary}
      />

      <Versions versions={details.versions} libraries={known} />
      <CastRow credits={details.credits} title={config.castTitle} />
      <Reviews reviews={details.reviews} />
      <TmdbCredit />
    </article>
  )
}

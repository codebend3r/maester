import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DOWNLOAD_TARGET_KINDS,
  type ItemDetails,
  type Library,
  type MatchItemType,
  type MediaItem,
  TITLE_DISPLAYS,
  directedBy,
  episodeBackPath,
  episodeByline,
  episodeFacts,
  formatDuration,
  formatRuntime,
  inLibrary,
  itemPath,
  movieFacts,
  progressOf,
  watchLink,
} from '@raven/core'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, ButtonLink } from '@raven/ui'
import type { BackFallback } from '@/components/BackButton/BackButton'
import { AiMatchNote } from '@/components/AiMatchNote/AiMatchNote'
import { CastRow } from '@/components/CastRow/CastRow'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import {
  type HeaderProgress,
  ItemHeader,
  pictureBackdrop,
} from '@/components/ItemHeader/ItemHeader'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { MetadataEditor } from '@/components/MetadataEditor/MetadataEditor'
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
import styles from '@/components/PlayableItemView/PlayableItemView.module.scss'

type Facts = { details: ItemDetails; primary: MediaItem }

/**
 * A movie has a poster and a backdrop. An episode has its still, else the
 * file's frame grab, under its season's backdrop, which is its show's.
 */
const PAGE_PICTURES = { posterAndBackdrop: 'poster and backdrop', still: 'still' } as const

/** How a movie's page and an episode's page differ; everything else they share. */
type PlayableConfig = {
  matchType: MatchItemType
  back: (facts: Facts & { libraries: readonly Library[] }) => BackFallback
  /** The small line over the title: an episode's show and number. */
  eyebrow: (details: ItemDetails) => string[]
  byline: (details: ItemDetails) => string | null
  facts: (facts: Facts) => string[]
  pictures: (typeof PAGE_PICTURES)[keyof typeof PAGE_PICTURES]
  /** Whether the page offers Edit images and Edit metadata, once the admin lock is off. */
  editable: boolean
  showsTagline: boolean
  showsContentRating: boolean
  showsReviews: boolean
  /** Whether a link to the saga the movie is in sits under the header. */
  showsSaga: boolean
  /** Whether the header says how long is left of a video started, with its line. */
  showsTimeLeft: boolean
  /** Whether the episodes either side follow the file. */
  showsNeighbours: boolean
  castTitle: string | undefined
}

const PLAYABLE = {
  movie: {
    matchType: 'movie',
    back: ({ primary, libraries }) => ({
      to: `/libraries/${primary.libraryId}`,
      label: libraries.find((entry) => entry.id === primary.libraryId)?.name ?? 'Library',
    }),
    eyebrow: () => [],
    byline: directedBy,
    facts: movieFacts,
    pictures: PAGE_PICTURES.posterAndBackdrop,
    editable: true,
    showsTagline: true,
    showsContentRating: true,
    showsReviews: true,
    showsSaga: true,
    showsTimeLeft: false,
    showsNeighbours: false,
    castTitle: undefined,
  },
  episode: {
    matchType: 'show',
    back: ({ details, primary }) => ({
      to: episodeBackPath({ item: details, libraryId: primary.libraryId }),
      label: details.show?.title ?? 'Library',
    }),
    eyebrow: (details) => [episodeByline(details)].filter(Boolean),
    byline: () => null,
    facts: episodeFacts,
    pictures: PAGE_PICTURES.still,
    editable: false,
    showsTagline: false,
    showsContentRating: false,
    showsReviews: false,
    showsSaga: false,
    showsTimeLeft: true,
    showsNeighbours: true,
    castTitle: 'Guest stars & crew',
  },
} as const satisfies Record<'movie' | 'episode', PlayableConfig>

/** How much of a video started is left, with its line; nothing for one not started. */
const timeLeft = (media: MediaItem): HeaderProgress | undefined => {
  const fraction = progressOf(media)
  const left = formatRuntime((media.duration ?? 0) - media.position)
  return fraction > 0 && left ? { fraction, label: `${left} left` } : undefined
}

/**
 * A movie's or an episode's page once the item, the library's files it
 * shows and the version Play starts are known: the header with Play,
 * favourite and Watched, and with the admin lock off the editors and the
 * file's menu (its picture plays too), whether this browser cannot play
 * that version, then the summary beside the file's facts, its versions, an
 * episode's neighbours, the people, a movie's reviews and TMDB's credit.
 * Only Edit images lists every library's files, since the pictures are the
 * item's wherever its files are.
 */
export const PlayableItemView = ({
  kind,
  details: item,
  versions,
  everyCard,
  primary,
}: {
  kind: keyof typeof PLAYABLE
  /** The item with every file this browser may see, in any library. */
  details: ItemDetails
  /** The files on the one card, in the one library, the page is for. */
  versions: MediaItem[]
  /** The item's files in that library, on every card. */
  everyCard: MediaItem[]
  primary: MediaItem
}) => {
  const details = { ...item, versions }
  const config: PlayableConfig = PLAYABLE[kind]
  const titleId = useId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingImages, setEditingImages] = useState(false)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const { favourite, watched } = useMediaMutations({ media: primary })
  // A locked library's videos are never marked, but one marked before it locked can be unmarked.
  const canFavourite = useCanFavourite(primary.libraryId) || primary.favourite
  const libraries = useQuery(librariesQuery)
  const tracks = useQuery(tracksQuery(primary.id))
  // The neighbours read the show too, so the backdrop costs no request of its own.
  const show = useQuery(itemQuery(item.show?.id ?? null))
  // A logo until Settings says to spell titles out, as a fresh install does.
  const showsLogo = useQuery(displaySettingsQuery).data?.titles !== TITLE_DISPLAYS.text
  const known = libraries.data ?? []
  const back = config.back({ details, primary, libraries: known })
  const tagline = config.showsTagline ? details.tagline : null
  const play = watchLink({ media: primary })
  const playPicture = { ...play, label: `Play ${details.title}` }
  const still =
    api.itemImageUrl({ id: details.id, kind: 'still', version: details.backdropVersion }) ??
    api.thumbnailUrl(primary)
  const showBackdrop = show.data
    ? api.itemImageUrl({
        id: show.data.id,
        kind: 'backdrop',
        version: show.data.backdropVersion,
      })
    : null
  // The still stands in only for a show with no backdrop, not while the show is read.
  const episodeBackdrop = item.show && show.isPending ? null : (showBackdrop ?? still)
  const hasSummary = !!tagline || !!details.summary

  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <ItemHeader
        back={back}
        titleId={titleId}
        eyebrow={config.eyebrow(details)}
        title={details.title}
        byline={config.byline(details)}
        contentRating={config.showsContentRating ? details.contentRating : null}
        facts={config.facts({ details, primary })}
        ratings={details.ratings}
        progress={config.showsTimeLeft ? timeLeft(primary) : undefined}
        logo={
          showsLogo
            ? api.itemImageUrl({ id: details.id, kind: 'logo', version: details.logoVersion })
            : null
        }
        {...(config.pictures === PAGE_PICTURES.posterAndBackdrop
          ? {
              picture: {
                shape: 'poster',
                url: api.itemImageUrl({
                  id: details.id,
                  kind: 'poster',
                  version: details.posterVersion,
                }),
                play: playPicture,
              },
              backdrop: pictureBackdrop(
                api.itemImageUrl({
                  id: details.id,
                  kind: 'backdrop',
                  version: details.backdropVersion,
                }),
              ),
            }
          : {
              picture: { shape: 'still', url: still, play: playPicture },
              backdrop: pictureBackdrop(episodeBackdrop),
            })}
        manage={
          <AdminOnly>
            {config.editable && (
              <>
                <Button
                  icon="edit"
                  aria-pressed={editingImages}
                  onClick={() => setEditingImages((editing) => !editing)}
                >
                  Edit images
                </Button>
                <Button
                  icon="edit"
                  aria-pressed={editingMetadata}
                  onClick={() => setEditingMetadata((editing) => !editing)}
                >
                  Edit metadata
                </Button>
              </>
            )}
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
                    ? `/libraries/${updated.libraryId}`
                    : inLibrary({ page, libraryId: updated.libraryId }),
                  { replace: true },
                )
              }}
              onDeleted={() => {
                if (details.versions.length <= 1) navigate(back.to)
                else void queryClient.invalidateQueries({ queryKey: queryKeys.item(details.id) })
              }}
            />
          </AdminOnly>
        }
      >
        <ButtonLink tone="primary" icon="play" to={play.to} state={play.state}>
          {primary.position > 0 ? `Resume from ${formatDuration(primary.position)}` : 'Play'}
        </ButtonLink>
        <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.media, mediaId: primary.id }} />
        {canFavourite && (
          <FavouriteButton isFavourite={primary.favourite} onToggle={favourite.mutate} />
        )}
        <WatchedToggle
          state={primary.watched ? 'watched' : 'unwatched'}
          onToggle={() => watched.mutate(!primary.watched)}
        />
      </ItemHeader>

      <PlaybackNote media={primary} />

      {details.aiMatch && <AiMatchNote aiMatch={details.aiMatch} />}

      {config.showsSaga && <SagaLink itemId={details.id} libraryId={primary.libraryId} />}

      <AdminOnly>
        {config.editable && editingImages && (
          <ImageEditor details={item} libraries={known} onDone={() => setEditingImages(false)} />
        )}
        {config.editable && editingMetadata && (
          <MetadataEditor
            details={details}
            everyCard={everyCard}
            itemKind="movie"
            onDone={() => setEditingMetadata(false)}
          />
        )}
      </AdminOnly>

      {config.showsNeighbours ? (
        <>
          <Summary tagline={null} summary={details.summary} />
          <div className={`${styles.about} ${styles.besides}`}>
            <FileFacts media={primary} tracks={tracks.data} className={styles.main} />
            <EpisodeNeighbours
              episode={details}
              libraryId={primary.libraryId}
              className={styles.aside}
            />
          </div>
        </>
      ) : (
        <div className={hasSummary ? `${styles.about} ${styles.besides}` : styles.about}>
          <Summary tagline={tagline} summary={details.summary} className={styles.main} />
          <FileFacts
            media={primary}
            tracks={tracks.data}
            className={hasSummary ? styles.aside : undefined}
          />
        </div>
      )}

      <Versions versions={details.versions} libraries={known} />
      <CastRow credits={details.credits} title={config.castTitle} />
      {config.showsReviews && <ReviewCards reviews={details.reviews} />}
      <TmdbCredit />
    </article>
  )
}

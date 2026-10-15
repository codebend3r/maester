import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ItemDetails,
  type Library,
  type MatchItemType,
  type MediaItem,
  formatDuration,
} from '@raven/core'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, ButtonLink } from '@/components/Button/Button'
import { AiMatchNote } from '@/components/AiMatchNote/AiMatchNote'
import { CastRow } from '@/components/CastRow/CastRow'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { ItemHeader, pictureBackdrop } from '@/components/ItemHeader/ItemHeader'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { MetadataEditor } from '@/components/MetadataEditor/MetadataEditor'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { ReviewCards } from '@/components/ReviewCards/ReviewCards'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { Versions } from '@/components/Versions/Versions'
import { api } from '@/lib/api'
import { directedBy, episodeByline, episodeFacts, fileFacts, movieFacts } from '@/lib/itemFacts'
import { episodeBackPath, inLibrary, itemPath, watchLink } from '@/lib/itemLinks'
import { displaySettingsQuery, librariesQuery, tracksQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/queryClient'
import { useMediaMutations } from '@/lib/useMediaMutations'
import styles from '@/components/PlayableItemView/PlayableItemView.module.scss'

type Facts = { details: ItemDetails; primary: MediaItem }

/** How a movie's page and an episode's page differ; everything else they share. */
type PlayableConfig = {
  matchType: MatchItemType
  back: (facts: Facts & { libraries: readonly Library[] }) => { to: string; label: string }
  byline: (details: ItemDetails) => string | null
  facts: (facts: Facts) => string[]
  /** A movie has a poster and a backdrop; an episode has its still, else the file's frame grab, for both. */
  pictures: 'poster and backdrop' | 'still'
  /** Whether the page offers Edit images and Edit metadata, once the admin lock is off. */
  editable: boolean
  showsTagline: boolean
  showsContentRating: boolean
  /** Whether every score's source gets a chip, one with none saying so. */
  showsEveryScore: boolean
  showsReviews: boolean
  castTitle: string | undefined
}

const PLAYABLE = {
  movie: {
    matchType: 'movie',
    back: ({ primary, libraries }) => ({
      to: `/libraries/${primary.libraryId}`,
      label: libraries.find((entry) => entry.id === primary.libraryId)?.name ?? 'Library',
    }),
    byline: directedBy,
    facts: movieFacts,
    pictures: 'poster and backdrop',
    editable: true,
    showsTagline: true,
    showsContentRating: true,
    showsEveryScore: true,
    showsReviews: true,
    castTitle: undefined,
  },
  episode: {
    matchType: 'show',
    back: ({ details, primary }) => ({
      to: episodeBackPath({ item: details, libraryId: primary.libraryId }),
      label: details.show?.title ?? 'Library',
    }),
    byline: episodeByline,
    facts: episodeFacts,
    pictures: 'still',
    editable: false,
    showsTagline: false,
    showsContentRating: false,
    showsEveryScore: false,
    showsReviews: false,
    castTitle: 'Guest stars & crew',
  },
} as const satisfies Record<'movie' | 'episode', PlayableConfig>

/**
 * A movie's or an episode's page once the item, the library's files it
 * shows and the version Play starts are known: the header with Play,
 * favourite and, with the admin lock off, the editors and the file's menu
 * (its picture plays too), whether this browser needs that version
 * converted or cannot play it, then the summary, the file, its versions and
 * the people. Only Edit images lists every library's files, since the
 * pictures are the item's wherever its files are.
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
  const ids = { title: useId(), file: useId() }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingImages, setEditingImages] = useState(false)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const { favourite } = useMediaMutations({ media: primary })
  const libraries = useQuery(librariesQuery)
  const tracks = useQuery(tracksQuery(primary.id))
  // A logo until Settings says to spell titles out, as a fresh install does.
  const showsLogo = useQuery(displaySettingsQuery).data?.titles !== 'text'
  const known = libraries.data ?? []
  const back = config.back({ details, primary, libraries: known })
  const facts = fileFacts({ media: primary, tracks: tracks.data })
  const tagline = config.showsTagline ? details.tagline : null
  const hasSummary = !!tagline || !!details.summary
  const play = watchLink({ media: primary })
  const playPicture = { ...play, label: `Play ${details.title}` }
  const still =
    api.itemImageUrl({ id: details.id, kind: 'still', version: details.backdropVersion }) ??
    api.thumbnailUrl(primary)

  return (
    <article className={styles.page} aria-labelledby={ids.title}>
      <ItemHeader
        back={back}
        titleId={ids.title}
        title={details.title}
        byline={config.byline(details)}
        contentRating={config.showsContentRating ? details.contentRating : null}
        facts={config.facts({ details, primary })}
        ratings={details.ratings}
        shouldShowEverySource={config.showsEveryScore}
        logo={
          showsLogo
            ? api.itemImageUrl({ id: details.id, kind: 'logo', version: details.logoVersion })
            : null
        }
        {...(config.pictures === 'poster and backdrop'
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
              backdrop: pictureBackdrop(still),
            })}
      >
        <ButtonLink tone="primary" icon="play" to={play.to} state={play.state}>
          {primary.position > 0 ? `Resume from ${formatDuration(primary.position)}` : 'Play'}
        </ButtonLink>
        <Button
          icon="heart"
          aria-label="Favourite"
          aria-pressed={primary.favourite}
          className={primary.favourite ? styles.favourited : undefined}
          onClick={() => favourite.mutate(!primary.favourite)}
        />
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
          {/* Without its favourite, which the page has beside it, all the menu holds needs the admin lock off. */}
          <MediaMenu
            media={primary}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            inline
            matchType={config.matchType}
            aiMatch={details.aiMatch}
            withFavourite={false}
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
      </ItemHeader>

      <PlaybackNote media={primary} />

      {details.aiMatch && <AiMatchNote aiMatch={details.aiMatch} />}

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

      <div
        className={
          hasSummary && facts.length > 0 ? `${styles.about} ${styles.besideFile}` : styles.about
        }
      >
        <Summary tagline={tagline} summary={details.summary} className={styles.summary} />
        {facts.length > 0 && (
          <section className={styles.file} aria-labelledby={ids.file}>
            <h2 id={ids.file} className="visually-hidden">
              File
            </h2>
            <dl className={styles.facts}>
              {facts.map((fact) => (
                <div key={fact.label} className={styles.fact}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      <Versions versions={details.versions} libraries={known} />
      <CastRow credits={details.credits} title={config.castTitle} />
      {config.showsReviews && <ReviewCards reviews={details.reviews} />}
      <TmdbCredit />
    </article>
  )
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ItemDetails, type Library, type MediaItem, formatDuration } from '@raven/core'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { CastRow } from '@/components/CastRow/CastRow'
import type { MatchType } from '@/components/FixMatchDialog/FixMatchDialog'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { MetadataEditor } from '@/components/MetadataEditor/MetadataEditor'
import { ReviewCards } from '@/components/ReviewCards/ReviewCards'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { Versions } from '@/components/Versions/Versions'
import { api } from '@/lib/api'
import { directedBy, episodeByline, episodeFacts, fileFacts, movieFacts } from '@/lib/itemFacts'
import { episodeBackPath, itemPath, watchLink } from '@/lib/itemLinks'
import { librariesQuery, tracksQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/queryClient'
import { useMediaMutations } from '@/lib/useMediaMutations'
import styles from '@/components/PlayableItemView/PlayableItemView.module.scss'

type Facts = { details: ItemDetails; primary: MediaItem }

/** How a movie's page and an episode's page differ; everything else they share. */
type PlayableConfig = {
  matchType: MatchType
  back: (facts: Facts & { libraries: readonly Library[] }) => { to: string; label: string }
  byline: (details: ItemDetails) => string | null
  facts: (facts: Facts) => string[]
  /** An episode has a still and no poster. */
  pictures: 'poster and backdrop' | 'still'
  /** Whether the page offers Edit images and Edit metadata. */
  editable: boolean
  showsTagline: boolean
  showsContentRating: boolean
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
    showsReviews: false,
    castTitle: 'Guest stars & crew',
  },
} as const satisfies Record<'movie' | 'episode', PlayableConfig>

/**
 * A movie's or an episode's page once the item and the version Play starts
 * are known: the header with Play, favourite and the file's menu, then the
 * summary, the file, its versions and the people.
 */
export const PlayableItemView = ({
  kind,
  details,
  primary,
}: {
  kind: keyof typeof PLAYABLE
  details: ItemDetails
  primary: MediaItem
}) => {
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
  const known = libraries.data ?? []
  const back = config.back({ details, primary, libraries: known })
  const facts = fileFacts({ media: primary, tracks: tracks.data })
  const play = watchLink(primary)

  return (
    <article className={styles.page} aria-labelledby={ids.title}>
      <ButtonLink to={back.to} icon="back" className={styles.back}>
        {back.label}
      </ButtonLink>

      <ItemHeader
        titleId={ids.title}
        title={details.title}
        byline={config.byline(details)}
        contentRating={config.showsContentRating ? details.contentRating : null}
        facts={config.facts({ details, primary })}
        ratings={details.ratings}
        {...(config.pictures === 'poster and backdrop'
          ? {
              poster: api.itemImageUrl({
                id: details.id,
                kind: 'poster',
                version: details.posterVersion,
              }),
              backdrop: api.itemImageUrl({
                id: details.id,
                kind: 'backdrop',
                version: details.backdropVersion,
              }),
            }
          : {
              backdrop: api.itemImageUrl({
                id: details.id,
                kind: 'still',
                version: details.backdropVersion,
              }),
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
          disabled={favourite.isPending}
          onClick={() => favourite.mutate(!primary.favourite)}
        />
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
        <MediaMenu
          media={primary}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          inline
          matchType={config.matchType}
          withFavourite={false}
          onMatched={(updated) => {
            const page = updated.item ? itemPath(updated.item) : null
            navigate(page ?? `/libraries/${updated.libraryId}`, { replace: true })
          }}
          onDeleted={() => {
            if (details.versions.length <= 1) navigate(back.to)
            else void queryClient.invalidateQueries({ queryKey: queryKeys.item(details.id) })
          }}
        />
      </ItemHeader>

      {editingImages && (
        <ImageEditor details={details} libraries={known} onDone={() => setEditingImages(false)} />
      )}
      {editingMetadata && (
        <MetadataEditor
          details={details}
          itemKind="movie"
          onDone={() => setEditingMetadata(false)}
        />
      )}

      <Summary tagline={config.showsTagline ? details.tagline : null} summary={details.summary} />

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

      <Versions versions={details.versions} libraries={known} />
      <CastRow credits={details.credits} title={config.castTitle} />
      {config.showsReviews && <ReviewCards reviews={details.reviews} />}
      <TmdbCredit />
    </article>
  )
}

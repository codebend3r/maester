import { useQuery } from '@tanstack/react-query'
import { type ItemDetails, type SeasonSummary, episodeCode, watchedStateOf } from '@raven/core'
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { AiMatchNote } from '@/components/AiMatchNote/AiMatchNote'
import { Button, ButtonLink } from '@raven/ui'
import { CastRow } from '@/components/CastRow/CastRow'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { ItemHeader, ItemHeaderSkeleton, pictureBackdrop } from '@/components/ItemHeader/ItemHeader'
import { MetadataEditor } from '@/components/MetadataEditor/MetadataEditor'
import { ReviewCards } from '@/components/ReviewCards/ReviewCards'
import { RouteState } from '@/components/RouteState/RouteState'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { WatchedCount } from '@/components/WatchedCount/WatchedCount'
import { WatchedToggle } from '@/components/WatchedToggle/WatchedToggle'
import { api } from '@/lib/api'
import { createdBy, showFacts } from '@/lib/itemFacts'
import { itemPath, watchLink } from '@/lib/itemLinks'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import { nextEpisodeQuery } from '@/lib/queries'
import { useRouteItem } from '@/lib/routeQuery'
import { useWatchedToggle } from '@/lib/useWatchedChange'
import styles from '@/pages/ShowPage/ShowPage.module.scss'

/** One season in the row: its poster, name and how many episodes are on disk. */
const SeasonCard = ({ season, show }: { season: SeasonSummary; show: ItemDetails }) => {
  const poster = posterSources({ item: season, sizes: POSTER_SIZES.season })
  const to = itemPath(season) ?? `/shows/${show.id}`
  const count = season.episodeCount
  return (
    <li className={styles.season}>
      <Link to={to} className={styles.seasonLink}>
        <span className={styles.seasonPoster}>
          {poster ? (
            <img {...poster} alt="" loading="lazy" decoding="async" />
          ) : (
            <span aria-hidden="true">{season.season ?? ''}</span>
          )}
          <WatchedCount
            watched={season.watchedCount}
            total={season.episodeCount}
            className={styles.seasonWatched}
          />
        </span>
        <span className={styles.seasonTitle}>{season.title}</span>
        <span className={styles.seasonCount}>
          {count} {count === 1 ? 'episode' : 'episodes'}
        </span>
      </Link>
    </li>
  )
}

const ShowView = ({ details }: { details: ItemDetails }) => {
  const ids = { title: useId(), seasons: useId() }
  const navigate = useNavigate()
  const [fixing, setFixing] = useState(false)
  const [editingImages, setEditingImages] = useState(false)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const next = useQuery(nextEpisodeQuery(details.id))
  const libraryId = next.data?.libraryId ?? details.versions[0]?.libraryId
  const code = next.data?.item ? episodeCode(next.data.item) : null
  const seasons = details.children.flatMap((child) => (child.type === 'season' ? [child] : []))
  const toggle = useWatchedToggle({
    state: watchedStateOf({
      watched: seasons.reduce((sum, season) => sum + season.watchedCount, 0),
      total: seasons.reduce((sum, season) => sum + season.episodeCount, 0),
    }),
    targets: [{ kind: 'item', id: details.id, libraryId: null }],
  })

  return (
    <article className={styles.page} aria-labelledby={ids.title}>
      <ItemHeader
        back={{
          to: libraryId == null ? '/libraries' : `/libraries/${libraryId}`,
          label: 'Library',
        }}
        titleId={ids.title}
        title={details.title}
        byline={createdBy(details)}
        contentRating={details.contentRating}
        facts={showFacts(details)}
        ratings={details.ratings}
        picture={{
          shape: 'poster',
          url: api.itemImageUrl({
            id: details.id,
            kind: 'poster',
            version: details.posterVersion,
          }),
        }}
        backdrop={pictureBackdrop(
          api.itemImageUrl({ id: details.id, kind: 'backdrop', version: details.backdropVersion }),
        )}
      >
        {next.data && (
          <ButtonLink tone="primary" icon="play" {...watchLink({ media: next.data })}>
            {code ? `Play ${code}` : 'Play'}
          </ButtonLink>
        )}
        <WatchedToggle {...toggle} />
        <AdminOnly>
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
          <Button icon="search" onClick={() => setFixing(true)}>
            Fix match
          </Button>
        </AdminOnly>
      </ItemHeader>

      {details.aiMatch && <AiMatchNote aiMatch={details.aiMatch} />}

      <AdminOnly>
        {editingImages && (
          <ImageEditor
            details={details}
            libraries={[]}
            itemKind="show"
            onDone={() => setEditingImages(false)}
          />
        )}
        {editingMetadata && (
          <MetadataEditor
            details={details}
            itemKind="show"
            onDone={() => setEditingMetadata(false)}
          />
        )}
      </AdminOnly>

      <Summary tagline={details.tagline} summary={details.summary} />

      {seasons.length > 0 && (
        <section className={styles.seasons} aria-labelledby={ids.seasons}>
          <h2 id={ids.seasons} className={styles.heading}>
            Seasons
          </h2>
          <ul className={styles.seasonRow}>
            {seasons.map((season) => (
              <SeasonCard key={season.id} season={season} show={details} />
            ))}
          </ul>
        </section>
      )}

      <CastRow credits={details.credits} />
      <ReviewCards reviews={details.reviews} />
      <TmdbCredit />

      <AdminOnly>
        {fixing && (
          <FixMatchDialog
            type="show"
            title={details.title}
            year={details.year}
            libraryId={libraryId}
            subject={{ kind: 'item', id: details.id }}
            aiMatch={details.aiMatch}
            allowNone={false}
            match={(tmdbId) =>
              tmdbId == null
                ? Promise.reject(new Error('Pick a show.'))
                : api.setItemMatch({ itemId: details.id, tmdbId })
            }
            onMatched={(moved) => navigate(`/shows/${moved.id}`, { replace: true })}
            onClose={() => setFixing(false)}
          />
        )}
      </AdminOnly>
    </article>
  )
}

/** `/shows/:id`: a show's backdrop, poster, creator, years, network, seasons and people. */
export const ShowPage = () => {
  const page = useRouteItem('show')
  if (page.state !== 'ready')
    return <RouteState state={page} noun="show" shape={<ItemHeaderSkeleton picture="poster" />} />
  return <ShowView details={page.data} />
}

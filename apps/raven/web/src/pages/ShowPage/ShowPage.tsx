import { useQuery } from '@tanstack/react-query'
import { type ItemDetails, type ItemSummary, episodeCode } from '@raven/core'
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { CastRow } from '@/components/CastRow/CastRow'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'
import { MetadataEditor } from '@/components/MetadataEditor/MetadataEditor'
import { ReviewCards } from '@/components/ReviewCards/ReviewCards'
import { RouteState } from '@/components/RouteState/RouteState'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { api } from '@/lib/api'
import { createdBy, showFacts } from '@/lib/itemFacts'
import { itemPath, watchLink } from '@/lib/itemLinks'
import { itemQuery, nextEpisodeQuery } from '@/lib/queries'
import { useRouteItem } from '@/lib/routeQuery'
import styles from '@/pages/ShowPage/ShowPage.module.scss'

/** One season in the row: its poster, name and how many episodes are on disk. */
const SeasonCard = ({ season, show }: { season: ItemSummary; show: ItemDetails }) => {
  const details = useQuery(itemQuery(season.id))
  const poster = api.itemImageUrl({ id: season.id, kind: 'poster', version: season.posterVersion })
  const to = itemPath(season) ?? `/shows/${show.id}`
  const count = details.data?.children.length
  return (
    <li className={styles.season}>
      <Link to={to} className={styles.seasonLink}>
        <span className={styles.seasonPoster}>
          {poster ? (
            <img src={poster} alt="" loading="lazy" decoding="async" />
          ) : (
            <span aria-hidden="true">{season.season ?? ''}</span>
          )}
        </span>
        <span className={styles.seasonTitle}>{season.title}</span>
        {count != null && (
          <span className={styles.seasonCount}>
            {count} {count === 1 ? 'episode' : 'episodes'}
          </span>
        )}
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

  return (
    <article className={styles.page} aria-labelledby={ids.title}>
      <ButtonLink
        to={libraryId == null ? '/' : `/libraries/${libraryId}`}
        icon="back"
        className={styles.back}
      >
        Library
      </ButtonLink>

      <ItemHeader
        titleId={ids.title}
        title={details.title}
        byline={createdBy(details)}
        contentRating={details.contentRating}
        facts={showFacts(details)}
        ratings={details.ratings}
        poster={api.itemImageUrl({
          id: details.id,
          kind: 'poster',
          version: details.posterVersion,
        })}
        backdrop={api.itemImageUrl({
          id: details.id,
          kind: 'backdrop',
          version: details.backdropVersion,
        })}
      >
        {next.data && (
          <ButtonLink tone="primary" icon="play" {...watchLink(next.data)}>
            {code ? `Play ${code}` : 'Play'}
          </ButtonLink>
        )}
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
      </ItemHeader>

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

      <Summary tagline={details.tagline} summary={details.summary} />

      {details.children.length > 0 && (
        <section className={styles.seasons} aria-labelledby={ids.seasons}>
          <h2 id={ids.seasons} className={styles.heading}>
            Seasons
          </h2>
          <ul className={styles.seasonRow}>
            {details.children.map((season) => (
              <SeasonCard key={season.id} season={season} show={details} />
            ))}
          </ul>
        </section>
      )}

      <CastRow credits={details.credits} />
      <ReviewCards reviews={details.reviews} />
      <TmdbCredit />

      {fixing && (
        <FixMatchDialog
          type="show"
          title={details.title}
          year={details.year}
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
    </article>
  )
}

/** `/shows/:id`: a show's backdrop, poster, creator, years, network, seasons and people. */
export const ShowPage = () => {
  const page = useRouteItem('show')
  if (page.state !== 'ready') return <RouteState state={page} noun="show" />
  return <ShowView details={page.data} />
}

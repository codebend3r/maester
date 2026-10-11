import { useQuery } from '@tanstack/react-query'
import { ApiError, type ItemDetails, type ItemSummary, episodeCode } from '@raven/core'
import { useId, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { CastRow } from '@/components/CastRow/CastRow'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { api } from '@/lib/api'
import { createdBy } from '@/lib/itemFacts'
import { itemPath, showYears } from '@/lib/itemLinks'
import { queryKeys } from '@/lib/queryClient'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/ShowPage/ShowPage.module.scss'

/** "2022 to now", the network, and up to three genres. */
export const showFacts = (details: ItemDetails): string[] =>
  [
    showYears({
      year: details.year,
      endedYear: details.ended == null ? null : Number(details.ended.slice(0, 4)) || null,
    }),
    details.studio,
    ...details.genres.slice(0, 3),
  ].filter((fact): fact is string => fact != null)

/** One season in the row: its poster, name and how many episodes are on disk. */
const SeasonCard = ({ season, show }: { season: ItemSummary; show: ItemDetails }) => {
  const details = useQuery({
    queryKey: queryKeys.item(season.id),
    queryFn: () => api.getItem(season.id),
  })
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
  const next = useQuery({
    queryKey: queryKeys.nextEpisode(details.id),
    queryFn: () => api.nextEpisode(details.id),
  })
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
        ratings={details.ratings.filter((rating) => rating.source === 'tmdb')}
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
          <ButtonLink
            tone="primary"
            icon="play"
            to={`/watch/${next.data.id}`}
            state={{ media: next.data }}
          >
            {code ? `Play ${code}` : 'Play'}
          </ButtonLink>
        )}
        <Button icon="search" onClick={() => setFixing(true)}>
          Fix match
        </Button>
      </ItemHeader>

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
  const params = useParams()
  const id = Number(params.id)
  const item = useQuery({
    queryKey: queryKeys.item(id),
    queryFn: () => api.getItem(id),
    enabled: Number.isInteger(id),
  })

  const missing = item.error instanceof ApiError && item.error.status === 404
  if (!Number.isInteger(id) || missing) return <NotFoundPage />
  if (item.isError) {
    return (
      <p className={styles.message} role="alert">
        {item.error.message}
      </p>
    )
  }
  if (!item.data) return <p className={styles.message}>Opening the show</p>
  if (item.data.type !== 'show') return <NotFoundPage />
  return <ShowView details={item.data} />
}

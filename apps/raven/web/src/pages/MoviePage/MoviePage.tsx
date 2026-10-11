import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, type ItemDetails, type MediaItem, formatDuration } from '@raven/core'
import { useId, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { CastRow } from '@/components/CastRow/CastRow'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { Versions } from '@/components/Versions/Versions'
import { api } from '@/lib/api'
import { directedBy, fileFacts, movieFacts } from '@/lib/itemFacts'
import { itemPath } from '@/lib/itemLinks'
import { queryKeys } from '@/lib/queryClient'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/MoviePage/MoviePage.module.scss'

/** The page once the movie and its best file are known. */
const MovieView = ({ details, primary }: { details: ItemDetails; primary: MediaItem }) => {
  const ids = { title: useId(), file: useId() }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const { favourite } = useMediaMutations({ media: primary })
  const libraries = useQuery({ queryKey: queryKeys.libraries, queryFn: api.listLibraries })
  const tracks = useQuery({
    queryKey: queryKeys.mediaTracks(primary.id),
    queryFn: () => api.getTracks(primary.id),
  })
  const library = libraries.data?.find((entry) => entry.id === primary.libraryId)
  const facts = fileFacts({ media: primary, tracks: tracks.data })
  const tmdb = details.ratings.filter((rating) => rating.source === 'tmdb')

  return (
    <article className={styles.page} aria-labelledby={ids.title}>
      <ButtonLink to={`/libraries/${primary.libraryId}`} icon="back" className={styles.back}>
        {library?.name ?? 'Library'}
      </ButtonLink>

      <ItemHeader
        titleId={ids.title}
        title={details.title}
        byline={directedBy(details)}
        contentRating={details.contentRating}
        facts={movieFacts({ details, primary })}
        ratings={tmdb}
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
        <ButtonLink
          tone="primary"
          icon="play"
          to={`/watch/${primary.id}`}
          state={{ media: primary }}
        >
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
        <MediaMenu
          media={primary}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          inline
          matchType="movie"
          withFavourite={false}
          onMatched={(updated) => {
            const page = updated.item ? itemPath(updated.item) : null
            navigate(page ?? `/libraries/${updated.libraryId}`, { replace: true })
          }}
          onDeleted={() => {
            if (details.versions.length <= 1) navigate(`/libraries/${primary.libraryId}`)
            else void queryClient.invalidateQueries({ queryKey: queryKeys.item(details.id) })
          }}
        />
      </ItemHeader>

      <Summary tagline={details.tagline} summary={details.summary} />

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

      <Versions versions={details.versions} libraries={libraries.data ?? []} />
      <CastRow credits={details.credits} />
      <TmdbCredit />
    </article>
  )
}

/** `/movies/:id`: a movie's backdrop, poster, facts, scores, summary, files and people. */
export const MoviePage = () => {
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
  if (!item.data) return <p className={styles.message}>Opening the movie</p>

  // A saved spot wins, so Play resumes where the viewer stopped, in whichever version.
  const primary =
    item.data.versions.find((version) => version.position > 0) ?? item.data.versions[0]
  if (!primary) return <NotFoundPage />
  return <MovieView details={item.data} primary={primary} />
}

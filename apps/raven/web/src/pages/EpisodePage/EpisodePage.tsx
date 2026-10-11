import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  type ItemDetails,
  type MediaItem,
  formatDuration,
  formatRuntime,
} from '@raven/core'
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
import { fileFacts, formatAirDate } from '@/lib/itemFacts'
import { itemPath } from '@/lib/itemLinks'
import { queryKeys } from '@/lib/queryClient'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/EpisodePage/EpisodePage.module.scss'

/** "Severance · Season 1 · Episode 2". */
export const episodeByline = (details: ItemDetails): string =>
  [
    details.show?.title ?? null,
    details.season == null ? null : `Season ${details.season}`,
    details.episode == null ? null : `Episode ${details.episode}`,
  ]
    .filter((part): part is string => part != null)
    .join(' · ')

const EpisodeView = ({ details, primary }: { details: ItemDetails; primary: MediaItem }) => {
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
  const facts = fileFacts({ media: primary, tracks: tracks.data })
  const backLink = details.show
    ? (itemPath({ ...details, type: 'season' }) ?? `/shows/${details.show.id}`)
    : `/libraries/${primary.libraryId}`

  return (
    <article className={styles.page} aria-labelledby={ids.title}>
      <ButtonLink to={backLink} icon="back" className={styles.back}>
        {details.show?.title ?? 'Library'}
      </ButtonLink>

      <ItemHeader
        titleId={ids.title}
        title={details.title}
        byline={episodeByline(details)}
        contentRating={null}
        facts={[
          formatAirDate(details.released),
          formatRuntime(primary.duration) ??
            (details.runtime == null ? null : formatRuntime(details.runtime * 60)),
        ].filter((fact): fact is string => fact != null)}
        ratings={details.ratings}
        backdrop={api.itemImageUrl({
          id: details.id,
          kind: 'still',
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
          matchType="show"
          withFavourite={false}
          onMatched={(updated) => {
            const page = updated.item ? itemPath(updated.item) : null
            navigate(page ?? `/libraries/${updated.libraryId}`, { replace: true })
          }}
          onDeleted={() => {
            if (details.versions.length <= 1) navigate(backLink)
            else void queryClient.invalidateQueries({ queryKey: queryKeys.item(details.id) })
          }}
        />
      </ItemHeader>

      <Summary tagline={null} summary={details.summary} />

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
      <CastRow credits={details.credits} title="Guest stars & crew" />
      <TmdbCredit />
    </article>
  )
}

/** `/episodes/:id`: an episode's still, show and number, air date, summary, file and people. */
export const EpisodePage = () => {
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
  if (!item.data) return <p className={styles.message}>Opening the episode</p>
  const primary =
    item.data.versions.find((version) => version.position > 0) ?? item.data.versions[0]
  if (item.data.type !== 'episode' || !primary) return <NotFoundPage />
  return <EpisodeView details={item.data} primary={primary} />
}

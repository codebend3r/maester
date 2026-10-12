import { useQuery } from '@tanstack/react-query'
import type { EpisodeSummary, ItemDetails } from '@raven/core'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink } from '@/components/Button/Button'
import { Icon } from '@/components/Icon/Icon'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { RouteState } from '@/components/RouteState/RouteState'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { api } from '@/lib/api'
import { formatAirDate, runtimeFact } from '@/lib/itemFacts'
import { watchLink } from '@/lib/itemLinks'
import { itemQuery } from '@/lib/queries'
import { routeState, useRouteId } from '@/lib/routeQuery'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/SeasonPage/SeasonPage.module.scss'

/** One episode on disk: its still, number and title, air date and length, two lines of summary, and Play. */
const EpisodeRow = ({ episode }: { episode: EpisodeSummary }) => {
  const file = episode.primary ?? undefined
  // The still, from TMDB or beside the file; else a frame of the file itself.
  const picture =
    episode.stillVersion == null
      ? file
        ? api.thumbnailUrl(file)
        : null
      : api.itemImageUrl({ id: episode.id, kind: 'still', version: episode.stillVersion })
  const facts = [
    formatAirDate(episode.released),
    runtimeFact({ file, runtime: episode.runtime }),
  ].filter((fact): fact is string => fact != null)
  const number = episode.episode == null ? '' : `${episode.episode}. `

  return (
    <li className={styles.episode}>
      <Link
        to={`/episodes/${episode.id}`}
        className={styles.still}
        tabIndex={-1}
        aria-hidden="true"
      >
        {picture ? (
          <img src={picture} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.stillPlaceholder}>{episode.episode ?? ''}</span>
        )}
        {file && <ResumeBar media={file} className={styles.resume} />}
      </Link>
      <div className={styles.body}>
        <Link to={`/episodes/${episode.id}`} className={styles.title}>
          {number}
          {episode.title}
        </Link>
        {facts.length > 0 && (
          <span className={styles.facts}>
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </span>
        )}
        {episode.summary && <p className={styles.overview}>{episode.summary}</p>}
        {file && <PartlyWatched media={file} />}
      </div>
      {file && (
        <Link {...watchLink(file)} className={styles.play} aria-label={`Play ${episode.title}`}>
          <Icon name="play" size={16} />
        </Link>
      )}
    </li>
  )
}

const SeasonView = ({ show, season }: { show: ItemDetails; season: ItemDetails }) => {
  const ids = { title: useId(), episodes: useId() }
  const episodes = season.children.flatMap((child) => (child.type === 'episode' ? [child] : []))
  const count = episodes.length
  return (
    <article className={styles.page} aria-labelledby={ids.title}>
      <ButtonLink to={`/shows/${show.id}`} icon="back" className={styles.back}>
        {show.title}
      </ButtonLink>

      <ItemHeader
        titleId={ids.title}
        title={season.title}
        byline={show.title}
        contentRating={null}
        facts={[
          season.year == null ? null : String(season.year),
          `${count} ${count === 1 ? 'episode' : 'episodes'}`,
        ].filter((fact): fact is string => fact != null)}
        ratings={[]}
        picture={{
          shape: 'poster',
          url: api.itemImageUrl({ id: season.id, kind: 'poster', version: season.posterVersion }),
        }}
        backdrop={api.itemImageUrl({
          id: show.id,
          kind: 'backdrop',
          version: show.backdropVersion,
        })}
      />

      <Summary tagline={null} summary={season.summary} />

      <section aria-labelledby={ids.episodes} className={styles.episodes}>
        <h2 id={ids.episodes} className="visually-hidden">
          Episodes
        </h2>
        <ol className={styles.list}>
          {episodes.map((episode) => (
            <EpisodeRow key={episode.id} episode={episode} />
          ))}
        </ol>
      </section>

      <TmdbCredit />
    </article>
  )
}

/** `/shows/:id/seasons/:number`: a season's poster and summary, then its episodes on disk in order. */
export const SeasonPage = () => {
  const showId = useRouteId()
  const number = useRouteId('number')
  const showQuery = useQuery(itemQuery(showId))
  const summary = showQuery.data?.children.find((child) => child.season === number)
  const seasonQuery = useQuery(itemQuery(summary?.id ?? null))

  const show = routeState({ id: number == null ? null : showId, query: showQuery })
  if (show.state !== 'ready') return <RouteState state={show} noun="season" />
  if (!summary) return <NotFoundPage />
  const season = routeState({ id: summary.id, query: seasonQuery })
  if (season.state !== 'ready') return <RouteState state={season} noun="season" />
  return <SeasonView show={show.data} season={season.data} />
}

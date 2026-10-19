import { useQuery } from '@tanstack/react-query'
import {
  DOWNLOAD_TARGET_KINDS,
  type EpisodeSummary,
  ITEM_TYPES,
  type ItemDetails,
  episodeCode,
  episodeEntryKey,
  plural,
  watchedStateOf,
} from '@raven/core'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink, Icon } from '@raven/ui'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import {
  Dotted,
  ItemHeader,
  ItemHeaderSkeleton,
  pictureBackdrop,
} from '@/components/ItemHeader/ItemHeader'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { RouteState } from '@/components/RouteState/RouteState'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { SelectButton } from '@/components/SelectButton/SelectButton'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { SelectionBar } from '@/components/SelectionBar/SelectionBar'
import { SelectionScope, sourceOf } from '@/components/SelectionScope/SelectionScope'
import { ShuffleButton } from '@/components/ShuffleButton/ShuffleButton'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { WatchedMark } from '@/components/WatchedMark/WatchedMark'
import { WatchedToggle } from '@/components/WatchedToggle/WatchedToggle'
import { api } from '@/lib/api'
import { formatAirDate, runtimeFact } from '@/lib/itemFacts'
import { watchLink } from '@/lib/itemLinks'
import { itemQuery } from '@/lib/queries'
import { ROUTE_STATES, routeState, useRouteId } from '@/lib/routeQuery'
import { useItemFavourite } from '@/lib/useItemFavourite'
import { useSelectable } from '@/lib/useSelectable'
import { useWatchedToggle } from '@/lib/useWatchedChange'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/SeasonPage/SeasonPage.module.scss'

/**
 * One episode on disk, on a row that lights under the pointer: its still
 * with the check or where playback stopped, its number and title, air date
 * and length, three lines of summary, then Watched and Play.
 */
const EpisodeRow = ({ episode }: { episode: EpisodeSummary }) => {
  const select = useSelectable({ key: episodeEntryKey(episode), title: episode.title })
  const toggle = useWatchedToggle({
    state: episode.watched ? 'watched' : 'unwatched',
    targets: [{ kind: 'item', id: episode.id, libraryId: null }],
  })
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

  return (
    <li className={styles.episode} data-entry={episodeEntryKey(episode)} {...select.rootProps}>
      <SelectCheckbox select={select} className={styles.select} />
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
        <span className={styles.overlay}>
          <WatchedMark decorative watched={episode.watched} className={styles.watched} />
          {file && <ResumeBar media={file} className={styles.resume} />}
        </span>
      </Link>
      <div className={styles.body}>
        <p className={styles.heading}>
          {episode.episode != null && <span className={styles.code}>E{episode.episode}</span>}
          <Link
            to={`/episodes/${episode.id}`}
            className={styles.title}
            tabIndex={select.linkTabIndex}
          >
            {episode.title}
          </Link>
        </p>
        {facts.length > 0 && (
          <span className={styles.facts}>
            <Dotted parts={facts} />
          </span>
        )}
        {episode.summary && <p className={styles.overview}>{episode.summary}</p>}
        {file && <PartlyWatched media={file} />}
      </div>
      {!select.selecting && (
        <span className={styles.actions}>
          <WatchedToggle {...toggle} label={`Watched ${episode.title}`} isLabelShown={false} />
          {file && (
            <Link
              {...watchLink({ media: file })}
              className={styles.play}
              aria-label={`Play ${episode.title}`}
            >
              <Icon name="play" size={14} />
            </Link>
          )}
        </span>
      )}
    </li>
  )
}

const SeasonView = ({ show, season }: { show: ItemDetails; season: ItemDetails }) => {
  const ids = { title: useId(), episodes: useId() }
  const episodes = season.children.flatMap((child) =>
    child.type === ITEM_TYPES.episode ? [child] : [],
  )
  const count = episodes.length
  const watchedCount = episodes.filter((episode) => episode.watched).length
  // The first episode on disk not yet watched that has a file to play.
  const next = episodes.find((episode) => !episode.watched && episode.primary != null)
  const nextFile = next?.primary ?? null
  const nextCode = next ? episodeCode(next) : null
  const hasFiles = episodes.some((episode) => episode.primary != null)
  const toggle = useWatchedToggle({
    state: watchedStateOf({ watched: watchedCount, total: count }),
    targets: [{ kind: 'item', id: season.id, libraryId: null }],
  })
  const watchedWords = `${watchedCount} of ${count} watched`
  const favourite = useItemFavourite({ item: season })
  return (
    <SelectionScope
      {...sourceOf(
        episodes.map((episode) => [
          episodeEntryKey(episode),
          [{ kind: 'item', id: episode.id, libraryId: null }],
        ]),
      )}
    >
      <article className={styles.page} aria-labelledby={ids.title}>
        <ItemHeader
          back={{ to: `/shows/${show.id}`, label: show.title }}
          titleId={ids.title}
          eyebrow={[show.title]}
          title={season.title}
          byline={null}
          contentRating={show.contentRating}
          facts={[
            season.year == null ? null : String(season.year),
            plural({ n: count, one: 'episode', many: 'episodes' }),
          ].filter((fact): fact is string => fact != null)}
          ratings={[]}
          progress={count > 0 ? { fraction: watchedCount / count, label: watchedWords } : undefined}
          picture={{
            shape: 'poster',
            url: api.itemImageUrl({ id: season.id, kind: 'poster', version: season.posterVersion }),
          }}
          backdrop={pictureBackdrop(
            api.itemImageUrl({ id: show.id, kind: 'backdrop', version: show.backdropVersion }),
          )}
        >
          {nextFile && (
            <ButtonLink tone="primary" icon="play" {...watchLink({ media: nextFile })}>
              {nextCode ? `Play ${nextCode}` : 'Play'}
            </ButtonLink>
          )}
          {season.favourite != null && (
            <FavouriteButton isFavourite={season.favourite} onToggle={favourite.mutate} />
          )}
          {hasFiles && <ShuffleButton itemId={season.id}>Shuffle season</ShuffleButton>}
          {hasFiles && <ShuffleButton itemId={show.id}>Shuffle show</ShuffleButton>}
          <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.item, itemId: season.id }} />
          <WatchedToggle {...toggle} />
          <SelectButton />
        </ItemHeader>

        <Summary tagline={null} summary={season.summary} />

        <section aria-labelledby={ids.episodes} className={styles.episodes}>
          <SectionHeading id={ids.episodes} aside={count > 0 && watchedWords}>
            Episodes
          </SectionHeading>
          <ol className={styles.list}>
            {episodes.map((episode) => (
              <EpisodeRow key={episode.id} episode={episode} />
            ))}
          </ol>
        </section>

        <TmdbCredit />

        <SelectionBar />
      </article>
    </SelectionScope>
  )
}

/**
 * `/shows/:id/seasons/:number`: a season's poster under its show's
 * backdrop, how much of it is watched, Play for the next episode and Shuffle
 * for a random one of the season or the show, its summary, then its episodes
 * on disk in order.
 */
export const SeasonPage = () => {
  const showId = useRouteId()
  const number = useRouteId('number')
  const showQuery = useQuery(itemQuery(showId))
  const summary = showQuery.data?.children.find((child) => child.season === number)
  const seasonQuery = useQuery(itemQuery(summary?.id ?? null))

  const show = routeState({ id: number == null ? null : showId, query: showQuery })
  if (show.state !== ROUTE_STATES.ready)
    return <RouteState state={show} noun="season" shape={<ItemHeaderSkeleton picture="poster" />} />
  if (!summary) return <NotFoundPage />
  const season = routeState({ id: summary.id, query: seasonQuery })
  if (season.state !== ROUTE_STATES.ready)
    return (
      <RouteState state={season} noun="season" shape={<ItemHeaderSkeleton picture="poster" />} />
    )
  return <SeasonView show={show.data} season={season.data} />
}

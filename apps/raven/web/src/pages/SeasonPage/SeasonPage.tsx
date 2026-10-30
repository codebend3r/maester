import { useQuery } from '@tanstack/react-query'
import {
  DOWNLOAD_TARGET_KINDS,
  type EpisodeSummary,
  type ItemDetails,
  ROUTE_STATES,
  type RoutePending,
  type RouteQuery,
  SESSION_KINDS,
  type ViewingSession,
  episodeCode,
  episodeEntryKey,
  episodeRowFacts,
  episodeStillUrl,
  episodesOf,
  episodesWatched,
  nextEpisodeIn,
  routeState,
  seasonFacts,
  watchLink,
  watchedCountLabel,
  watchedStateOf,
  WATCH_TARGET_KINDS,
  ITEM_IMAGE_KINDS,
  WATCHED_STATES,
} from '@raven/core'
import { type ReactNode, useId } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink, Icon } from '@raven/ui'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import {
  Dotted,
  ItemHeader,
  ItemHeaderSkeleton,
  itemBackdrop,
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
import { itemQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { useItemFavourite } from '@/lib/useItemFavourite'
import { useSelectable } from '@/lib/useSelectable'
import { useWatchedToggle } from '@/lib/useWatchedChange'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { SEASON_COPY } from '@/pages/SeasonPage/copy'
import { FactText } from '@/components/ResolutionChip/ResolutionChip'
import styles from '@/pages/SeasonPage/SeasonPage.module.scss'

/** A season's page plays the rest of that season, then stops. */
const SEASON_SESSION: ViewingSession = { kind: SESSION_KINDS.season }

const STILL_KEYS = { picture: 'picture', number: 'number' } as const

type StillPictureProps = { picture: string }

const StillPicture = ({ picture }: StillPictureProps) => (
  <img src={picture} alt="" loading="lazy" decoding="async" />
)

type StillNumberProps = { number: ReactNode }

const StillNumber = ({ number }: StillNumberProps) => (
  <span className={styles.stillPlaceholder}>{number}</span>
)

type StillProps = {
  [STILL_KEYS.picture]: StillPictureProps
  [STILL_KEYS.number]: StillNumberProps
}

const STILLS = {
  [STILL_KEYS.picture]: StillPicture,
  [STILL_KEYS.number]: StillNumber,
} as const satisfies ViewsOf<StillProps>

type StillOfProps = { episode: EpisodeSummary }

/** An episode's still where it has one, else its number in the still's place. */
const stillOf = ({ episode }: StillOfProps): ViewOf<StillProps> => {
  const picture = episodeStillUrl({ api, episode })
  if (picture) return { key: STILL_KEYS.picture, props: { picture } }
  return { key: STILL_KEYS.number, props: { number: episode.episode ?? '' } }
}

type EpisodeRowProps = { episode: EpisodeSummary }

/**
 * One episode on disk, on a row that lights under the pointer: its still
 * with the check or where playback stopped, its number and title, air date
 * and length, three lines of summary, then Watched and Play.
 */
const EpisodeRow = ({ episode }: EpisodeRowProps) => {
  const select = useSelectable({ key: episodeEntryKey(episode), title: episode.title })
  const toggle = useWatchedToggle({
    state: episode.watched ? WATCHED_STATES.watched : WATCHED_STATES.unwatched,
    targets: [{ kind: WATCH_TARGET_KINDS.item, id: episode.id, libraryId: null }],
  })
  const file = episode.primary ?? undefined
  const facts = episodeRowFacts(episode)

  return (
    <li className={styles.episode} data-entry={episodeEntryKey(episode)} {...select.rootProps}>
      <SelectCheckbox select={select} className={styles.select} />
      <Link
        to={`/episodes/${episode.id}`}
        className={styles.still}
        tabIndex={-1}
        aria-hidden="true"
      >
        <KeyedView<StillProps> views={STILLS} view={stillOf({ episode })} />
        <span className={styles.overlay}>
          <WatchedMark decorative watched={episode.watched} className={styles.watched} />
          {file && <ResumeBar media={file} className={styles.resume} />}
        </span>
      </Link>
      <div className={styles.body}>
        <p className={styles.heading}>
          {episode.episode != null && (
            <span className={styles.code}>{SEASON_COPY.episodeNumber(episode.episode)}</span>
          )}
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
            <Dotted
              parts={facts.map((fact) => (
                <FactText key={fact} fact={fact} />
              ))}
            />
          </span>
        )}
        {episode.summary && <p className={styles.overview}>{episode.summary}</p>}
        {file && <PartlyWatched media={file} />}
      </div>
      {!select.selecting && (
        <span className={styles.actions}>
          <WatchedToggle
            {...toggle}
            label={SEASON_COPY.watched(episode.title)}
            isLabelShown={false}
          />
          {file && (
            <Link
              {...watchLink({ media: file, session: SEASON_SESSION })}
              className={styles.play}
              aria-label={SEASON_COPY.playEpisode(episode.title)}
            >
              <Icon name="play" size={14} />
            </Link>
          )}
        </span>
      )}
    </li>
  )
}

type SeasonViewProps = { show: ItemDetails; season: ItemDetails }

const SeasonView = ({ show, season }: SeasonViewProps) => {
  const ids = { title: useId(), episodes: useId() }
  const episodes = episodesOf(season)
  const { watched: watchedCount, total: count } = episodesWatched(episodes)
  const next = nextEpisodeIn(episodes)
  const nextFile = next?.primary ?? null
  const nextCode = next ? episodeCode(next) : null
  const hasFiles = episodes.some((episode) => episode.primary != null)
  const toggle = useWatchedToggle({
    state: watchedStateOf({ watched: watchedCount, total: count }),
    targets: [{ kind: WATCH_TARGET_KINDS.item, id: season.id, libraryId: null }],
  })
  const watchedWords = watchedCountLabel({ watched: watchedCount, total: count })
  const favourite = useItemFavourite({ item: season })
  return (
    <SelectionScope
      {...sourceOf(
        episodes.map((episode) => [
          episodeEntryKey(episode),
          [{ kind: WATCH_TARGET_KINDS.item, id: episode.id, libraryId: null }],
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
          facts={seasonFacts(season)}
          ratings={[]}
          progress={count > 0 ? { fraction: watchedCount / count, label: watchedWords } : undefined}
          picture={{
            shape: 'poster',
            url: api.itemImageUrl({
              id: season.id,
              kind: ITEM_IMAGE_KINDS.poster,
              version: season.posterVersion,
            }),
          }}
          backdrop={itemBackdrop({ id: show.id, version: show.backdropVersion })}
        >
          {nextFile && (
            <ButtonLink
              tone="primary"
              icon="play"
              {...watchLink({ media: nextFile, session: SEASON_SESSION })}
            >
              {SEASON_COPY.play(nextCode)}
            </ButtonLink>
          )}
          {season.favourite != null && (
            <FavouriteButton isFavourite={season.favourite} onToggle={favourite.mutate} />
          )}
          {hasFiles && (
            <ShuffleButton itemId={season.id}>{SEASON_COPY.shuffleSeason}</ShuffleButton>
          )}
          {hasFiles && <ShuffleButton itemId={show.id}>{SEASON_COPY.shuffleShow}</ShuffleButton>}
          <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.item, itemId: season.id }} />
          <WatchedToggle {...toggle} />
          <SelectButton />
        </ItemHeader>

        <Summary tagline={null} summary={season.summary} />

        <section aria-labelledby={ids.episodes} className={styles.episodes}>
          <SectionHeading id={ids.episodes} aside={count > 0 && watchedWords}>
            {SEASON_COPY.episodes}
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

const SEASON_VIEW_KEYS = { pending: 'pending', missing: 'missing', ready: 'ready' } as const

type SeasonViewsProps = {
  [SEASON_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [SEASON_VIEW_KEYS.missing]: Record<never, never>
  [SEASON_VIEW_KEYS.ready]: SeasonViewProps
}

const SEASON_VIEWS = {
  [SEASON_VIEW_KEYS.pending]: RouteState,
  [SEASON_VIEW_KEYS.missing]: NotFoundPage,
  [SEASON_VIEW_KEYS.ready]: SeasonView,
} as const satisfies ViewsOf<SeasonViewsProps>

type PendingSeasonProps = { state: RoutePending }

const pendingSeason = ({ state }: PendingSeasonProps): ViewOf<SeasonViewsProps> => ({
  key: SEASON_VIEW_KEYS.pending,
  props: { state, noun: SEASON_COPY.noun, shape: <ItemHeaderSkeleton picture="poster" /> },
})

type SeasonPageViewProps = {
  show: RouteQuery<ItemDetails>
  summaryId: number | null
  seasonQuery: Parameters<typeof routeState<ItemDetails>>[0]['query']
}

/** The show then the season on their way or failing, a season the show lacks, else the season. */
const seasonPageView = ({
  show,
  summaryId,
  seasonQuery,
}: SeasonPageViewProps): ViewOf<SeasonViewsProps> => {
  if (show.state !== ROUTE_STATES.ready) return pendingSeason({ state: show })
  if (summaryId == null) return { key: SEASON_VIEW_KEYS.missing, props: {} }
  const season = routeState({ id: summaryId, query: seasonQuery })
  if (season.state !== ROUTE_STATES.ready) return pendingSeason({ state: season })
  return { key: SEASON_VIEW_KEYS.ready, props: { show: show.data, season: season.data } }
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
  return (
    <KeyedView<SeasonViewsProps>
      views={SEASON_VIEWS}
      view={seasonPageView({ show, summaryId: summary?.id ?? null, seasonQuery })}
    />
  )
}

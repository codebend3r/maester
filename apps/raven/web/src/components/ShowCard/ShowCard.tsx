import {
  type MediaSort,
  type RatingSource,
  type ShowEntry,
  WATCHED_STATES,
  episodeCode,
  pickScore,
  showEntryKey,
  showSortFact,
  showYears,
  watchedStateOf,
  watchPageOf,
} from '@raven/core'
import { Icon } from '@raven/ui'
import { RatingBadge } from '@/components/RatingPanel/RatingPanel'
import { CardLink } from '@/components/CardLink/CardLink'
import { PosterOverlay } from '@/components/PosterOverlay/PosterOverlay'
import { ItemPoster } from '@/components/PosterImage/PosterImage'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { Bone } from '@/components/Skeleton/Skeleton'
import { WatchedCount, WatchedCountWords } from '@/components/WatchedCount/WatchedCount'
import { api } from '@/lib/api'
import { POSTER_SIZES, type PosterSizes, posterSources } from '@/lib/posters'
import { useHoverBackdrop } from '@/lib/useHoverBackdrop'
import { useSelectable } from '@/lib/useSelectable'
import { ViewportImage } from '@/components/ViewportImage/ViewportImage'
import styles from '@/components/ShowCard/ShowCard.module.scss'

type UseShowCardProps = {
  entry: ShowEntry
  ratingsSource: RatingSource
  sort: MediaSort | undefined
}

/**
 * What both shapes of a show's card share: its backdrop behind the page
 * while pointed at, its selection, its facts and score, and how its next
 * episode's play button is named.
 */
const useShowCard = ({ entry, ratingsSource, sort }: UseShowCardProps) => {
  const { show, next } = entry
  const hover = useHoverBackdrop(
    api.itemImageUrl({ id: show.id, kind: 'backdrop', version: show.backdropVersion }),
  )
  const select = useSelectable({ key: showEntryKey(show), title: show.title })
  const code = next?.item ? episodeCode(next.item) : null
  return {
    hover,
    select,
    code,
    score: pickScore({ ratings: show.ratings, source: ratingsSource }),
    sorted: sort ? showSortFact({ entry, sort }) : null,
    facts: [
      showYears({ year: show.year, endedYear: entry.endedYear }),
      `${entry.episodes} ${entry.episodes === 1 ? 'episode' : 'episodes'}`,
    ].filter((fact): fact is string => fact != null),
    playLabel: code ? `Play ${show.title} ${code}` : `Play ${show.title}`,
  }
}

type ShowFactsProps = {
  entry: ShowEntry
  facts: string[]
  score: ReturnType<typeof pickScore>
  className: string
}

/** The facts under a show's title, a dot apart, with its score and the words of its count. */
const ShowFacts = ({ entry, facts, score, className }: ShowFactsProps) => (
  <span className={className}>
    {facts.map((fact) => (
      <span key={fact} className={styles.fact}>
        {fact}
      </span>
    ))}
    {score && (
      <span className={styles.fact}>
        <RatingBadge rating={score} />
      </span>
    )}
    <WatchedCountWords watched={entry.watchedEpisodes} total={entry.episodes} />
  </span>
)

type ShowCardProps = {
  entry: ShowEntry
  ratingsSource?: RatingSource
  /** The order the listing is in, whose value the card shows. */
  sort?: MediaSort
  /** How wide the list holding the card shows its poster. */
  sizes: PosterSizes
}

/**
 * A show as a poster, its title, years and episode count beneath, as a row
 * on the home page lays it out. The card opens the show's page; its play
 * button starts the first episode not yet watched, carrying the file along
 * so the player starts at once. Sorted by when shows were added, it says
 * when the newest episode came.
 */
export const ShowCard = ({ entry, ratingsSource = 'tmdb', sort, sizes }: ShowCardProps) => {
  const { show, next } = entry
  const card = useShowCard({ entry, ratingsSource, sort })

  return (
    <li
      className={styles.card}
      data-entry={showEntryKey(show)}
      {...card.hover}
      {...card.select.rootProps}
    >
      <div className={styles.poster}>
        <CardLink
          to={`/shows/${show.id}`}
          className={styles.picture}
          tabIndex={-1}
          aria-hidden="true"
        >
          <span className={styles.frame}>
            <ItemPoster item={show} sizes={sizes} />
            <span className={styles.marks}>
              <WatchedCount decorative watched={entry.watchedEpisodes} total={entry.episodes} />
            </span>
          </span>
        </CardLink>
        <SelectCheckbox select={card.select} className={styles.select} />
        {next && (
          <PosterOverlay
            media={next}
            play={
              card.select.selecting
                ? null
                : { to: watchPageOf(next.id), state: { media: next }, label: card.playLabel }
            }
          />
        )}
      </div>
      <div className={styles.words}>
        <CardLink
          to={`/shows/${show.id}`}
          className={styles.title}
          tabIndex={card.select.linkTabIndex}
        >
          {show.title}
        </CardLink>
        {card.sorted && <span className={styles.sorted}>{card.sorted}</span>}
        <ShowFacts entry={entry} facts={card.facts} score={card.score} className={styles.facts} />
      </div>
    </li>
  )
}

type WideShowCardProps = {
  entry: ShowEntry
  ratingsSource?: RatingSource
  /** The order the listing is in, whose value the card shows. */
  sort?: MediaSort
}

/**
 * A show as a wide card, its poster beside its title, years and episodes,
 * on a ground washed toward the poster's own colours. Below them, the next
 * episode to play, or that every one is watched. The card opens the show's
 * page and its play button starts that episode at once. The wash is the
 * poster again, blurred: the same file, so nothing more is fetched.
 */
const WideShowCard = ({ entry, ratingsSource = 'tmdb', sort }: WideShowCardProps) => {
  const { show, next } = entry
  const card = useShowCard({ entry, ratingsSource, sort })
  const wash = posterSources({ item: show, sizes: POSTER_SIZES.showCard })
  const isWatched =
    watchedStateOf({ watched: entry.watchedEpisodes, total: entry.episodes }) ===
    WATCHED_STATES.watched
  const nextLabel = [card.code, next?.item?.title].filter(Boolean).join(' · ')

  return (
    <li
      className={styles.wide}
      data-entry={showEntryKey(show)}
      {...card.hover}
      {...card.select.rootProps}
    >
      <CardLink
        to={`/shows/${show.id}`}
        className={styles.widePicture}
        tabIndex={-1}
        aria-hidden="true"
      >
        <span className={styles.wideFrame}>
          <ItemPoster item={show} sizes={POSTER_SIZES.showCard} />
          {!isWatched && (
            <span className={styles.wideMarks}>
              <WatchedCount decorative watched={entry.watchedEpisodes} total={entry.episodes} />
            </span>
          )}
        </span>
      </CardLink>
      <SelectCheckbox select={card.select} className={styles.wideSelect} />
      <div className={styles.body}>
        <CardLink
          to={`/shows/${show.id}`}
          className={styles.wideTitle}
          tabIndex={card.select.linkTabIndex}
        >
          {show.title}
        </CardLink>
        {card.sorted && <span className={styles.wideSorted}>{card.sorted}</span>}
        <ShowFacts
          entry={entry}
          facts={card.facts}
          score={card.score}
          className={styles.wideFacts}
        />
        {next && !card.select.selecting && (
          <CardLink
            to={watchPageOf(next.id)}
            state={{ media: next }}
            className={styles.next}
            aria-label={card.playLabel}
          >
            <Icon name="play" size={14} />
            <span className={styles.nextLabel}>{nextLabel || 'Play'}</span>
          </CardLink>
        )}
        {!next && isWatched && (
          <span className={styles.done} aria-hidden="true">
            <Icon name="check" size={16} />
            All watched
          </span>
        )}
      </div>
      {wash && (
        <ViewportImage
          className={styles.wash}
          src={wash.src}
          srcSet={wash.srcSet}
          sizes={wash.sizes}
          alt=""
        />
      )}
    </li>
  )
}

type ShowGridProps = {
  shows: ShowEntry[]
  ratingsSource?: RatingSource
  sort?: MediaSort
}

/** The grid a TV library lays its shows out in, each a wide card. */
export const ShowGrid = ({ shows, ratingsSource = 'tmdb', sort }: ShowGridProps) => (
  <ul className={styles.grid}>
    {shows.map((entry) => (
      <WideShowCard key={entry.show.id} entry={entry} ratingsSource={ratingsSource} sort={sort} />
    ))}
  </ul>
)

/** A wide show card on its way: its poster's place, a line for its title and one for its facts. */
const WideShowSkeleton = () => (
  <li className={styles.wide}>
    <span className={styles.widePicture}>
      <span className={styles.wideFrame}>
        <Bone shape="fill" />
      </span>
    </span>
    <span className={styles.body}>
      <Bone shape="heading" width="most" />
      <Bone shape="small" width="half" />
    </span>
  </li>
)

type ShowGridSkeletonProps = { count?: number }

/** The show grid while its shows are on their way, as wide cards of stand-ins. */
export const ShowGridSkeleton = ({ count = 6 }: ShowGridSkeletonProps) => (
  <ul className={styles.grid}>
    {Array.from({ length: count }, (_, index) => (
      <WideShowSkeleton key={index} />
    ))}
  </ul>
)

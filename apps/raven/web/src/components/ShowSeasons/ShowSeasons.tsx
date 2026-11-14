import {
  type ItemDetails,
  type SeasonSummary,
  formatRuntime,
  itemPath,
  seasonEntryKey,
  showPath,
} from '@raven/core'
import type { ComponentType, ReactNode } from 'react'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { BUTTON_TONES, Button, type IconName } from '@raven/ui'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { SHOW_SEASONS_COPY } from '@/components/ShowSeasons/copy'
import styles from '@/components/ShowSeasons/ShowSeasons.module.scss'
import { WatchedCount } from '@/components/WatchedCount/WatchedCount'
import { COMMON_COPY } from '@/lib/copy'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import { useSelectable } from '@/lib/useSelectable'
import { SEASON_VIEWS, type SeasonView, useSeasonView } from '@/stores/seasonView'

const SEASON_POSTER_KEYS = { picture: 'picture', number: 'number' } as const

type SeasonPictureProps = { poster: NonNullable<ReturnType<typeof posterSources>> }

const SeasonPicture = ({ poster }: SeasonPictureProps) => (
  <img {...poster} alt="" loading="lazy" decoding="async" />
)

type SeasonNumberProps = { number: ReactNode }

const SeasonNumber = ({ number }: SeasonNumberProps) => <span aria-hidden="true">{number}</span>

type SeasonPosterProps = {
  [SEASON_POSTER_KEYS.picture]: SeasonPictureProps
  [SEASON_POSTER_KEYS.number]: SeasonNumberProps
}

const SEASON_POSTERS = {
  [SEASON_POSTER_KEYS.picture]: SeasonPicture,
  [SEASON_POSTER_KEYS.number]: SeasonNumber,
} as const satisfies ViewsOf<SeasonPosterProps>

type SeasonPosterOfProps = { season: SeasonSummary }

/** A season's poster where it has one, else its number in the poster's place. */
const seasonPosterOf = ({ season }: SeasonPosterOfProps): ViewOf<SeasonPosterProps> => {
  const poster = posterSources({ item: season, sizes: POSTER_SIZES.season })
  if (poster) return { key: SEASON_POSTER_KEYS.picture, props: { poster } }
  return { key: SEASON_POSTER_KEYS.number, props: { number: season.season ?? '' } }
}

/** A season's whole runtime, "9h 30m", or null when no episode of it has one. */
const seasonRuntime = (season: SeasonSummary): string | null =>
  formatRuntime((season.runtime ?? 0) * 60)

type SeasonProps = { season: SeasonSummary; show: ItemDetails }

const seasonLinkOf = ({ season, show }: SeasonProps): string =>
  itemPath(season) ?? showPath(show.id)

/** One season in the grid: its poster, name, episodes on disk and whole runtime. */
const SeasonCard = ({ season, show }: SeasonProps) => {
  const select = useSelectable({ key: seasonEntryKey(season), title: season.title })
  const facts = [COMMON_COPY.episodes(season.episodeCount), seasonRuntime(season)].filter(
    (fact) => fact != null,
  )
  return (
    <li className={styles.card} data-entry={seasonEntryKey(season)} {...select.rootProps}>
      <SelectCheckbox select={select} className={styles.select} />
      <Link
        to={seasonLinkOf({ season, show })}
        className={styles.cardLink}
        tabIndex={select.linkTabIndex}
      >
        <span className={styles.poster}>
          <KeyedView<SeasonPosterProps> views={SEASON_POSTERS} view={seasonPosterOf({ season })} />
          <WatchedCount
            watched={season.watchedCount}
            total={season.episodeCount}
            className={styles.watched}
          />
        </span>
        <span className={styles.text}>
          <span className={styles.title}>{season.title}</span>
          <span className={styles.facts}>{facts.join(SHOW_SEASONS_COPY.factSeparator)}</span>
        </span>
      </Link>
    </li>
  )
}

/** One season in the table: its name, then its episodes, how many are watched and its runtime. */
const SeasonRow = ({ season, show }: SeasonProps) => {
  const select = useSelectable({ key: seasonEntryKey(season), title: season.title })
  return (
    <tr className={styles.row} data-entry={seasonEntryKey(season)} {...select.rootProps}>
      <th scope="row" className={styles.nameCell}>
        <SelectCheckbox select={select} />
        <Link
          to={seasonLinkOf({ season, show })}
          className={styles.rowLink}
          tabIndex={select.linkTabIndex}
        >
          <span className={styles.thumb}>
            <KeyedView<SeasonPosterProps>
              views={SEASON_POSTERS}
              view={seasonPosterOf({ season })}
            />
          </span>
          <span className={styles.title}>{season.title}</span>
        </Link>
      </th>
      <td className={styles.number}>{season.episodeCount}</td>
      <td className={styles.number}>
        {SHOW_SEASONS_COPY.watched({ watched: season.watchedCount, total: season.episodeCount })}
      </td>
      <td className={styles.number}>{seasonRuntime(season) ?? SHOW_SEASONS_COPY.noRuntime}</td>
    </tr>
  )
}

type SeasonsViewProps = {
  seasons: readonly SeasonSummary[]
  show: ItemDetails
  labelledBy: string
}

/** The seasons as posters, as many to a line as fit, wrapping onto the next. */
const SeasonsGrid = ({ seasons, show, labelledBy }: SeasonsViewProps) => (
  <ul className={styles.grid} aria-labelledby={labelledBy}>
    {seasons.map((season) => (
      <SeasonCard key={season.id} season={season} show={show} />
    ))}
  </ul>
)

/** The seasons as a table, one row each, for comparing their numbers. */
const SeasonsTable = ({ seasons, show, labelledBy }: SeasonsViewProps) => (
  <div className={styles.tableWrap}>
    <table className={styles.table} aria-labelledby={labelledBy}>
      <thead>
        <tr>
          <th scope="col">{SHOW_SEASONS_COPY.columns.season}</th>
          <th scope="col" className={styles.number}>
            {SHOW_SEASONS_COPY.columns.episodes}
          </th>
          <th scope="col" className={styles.number}>
            {SHOW_SEASONS_COPY.columns.watched}
          </th>
          <th scope="col" className={styles.number}>
            {SHOW_SEASONS_COPY.columns.runtime}
          </th>
        </tr>
      </thead>
      <tbody>
        {seasons.map((season) => (
          <SeasonRow key={season.id} season={season} show={show} />
        ))}
      </tbody>
    </table>
  </div>
)

const SEASON_VIEW_COMPONENTS = {
  [SEASON_VIEWS.grid]: SeasonsGrid,
  [SEASON_VIEWS.table]: SeasonsTable,
} as const satisfies Record<SeasonView, ComponentType<SeasonsViewProps>>

const SEASON_VIEW_ICONS = {
  [SEASON_VIEWS.grid]: 'grid',
  [SEASON_VIEWS.table]: 'list',
} as const satisfies Record<SeasonView, IconName>

/** Grid or Table, as one segmented control beside the heading. */
const SeasonViewToggle = () => {
  const view = useSeasonView((state) => state.view)
  const setView = useSeasonView((state) => state.setView)
  return (
    <fieldset className={styles.views}>
      <legend className="visually-hidden">{SHOW_SEASONS_COPY.view}</legend>
      {Object.values(SEASON_VIEWS).map((option) => (
        <Button
          key={option}
          tone={BUTTON_TONES.ghost}
          icon={SEASON_VIEW_ICONS[option]}
          className={styles.view}
          aria-label={SHOW_SEASONS_COPY.views[option]}
          title={SHOW_SEASONS_COPY.views[option]}
          aria-pressed={view === option}
          onClick={() => setView(option)}
        />
      ))}
    </fieldset>
  )
}

type ShowSeasonsProps = { seasons: readonly SeasonSummary[]; show: ItemDetails }

/**
 * A show's seasons under their heading, as a wrapping grid of posters or as
 * a table, whichever the viewer last picked; each says how many of its
 * episodes are on disk and how long they run together.
 */
export const ShowSeasons = ({ seasons, show }: ShowSeasonsProps) => {
  const headingId = useId()
  const view = useSeasonView((state) => state.view)
  const View = SEASON_VIEW_COMPONENTS[view]
  return (
    <section className={styles.seasons} aria-labelledby={headingId}>
      <SectionHeading id={headingId} aside={<SeasonViewToggle />}>
        {SHOW_SEASONS_COPY.heading}
      </SectionHeading>
      <View seasons={seasons} show={show} labelledBy={headingId} />
    </section>
  )
}

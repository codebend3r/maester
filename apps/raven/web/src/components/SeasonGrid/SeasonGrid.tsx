import { seasonPath } from '@raven/core'
import { PosterTitleCard } from '@/components/TitleCard/TitleCard'
import { SEASON_GRID_COPY } from '@/components/SeasonGrid/copy'
import styles from '@/components/SeasonGrid/SeasonGrid.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import type { SeasonEntry } from '@/pages/LibraryPage/seasons'

/** A season's name: its number, or Specials for season 0. */
const seasonName = (season: number): string =>
  season === 0 ? SEASON_GRID_COPY.specials : SEASON_GRID_COPY.season(season)

type SeasonGridProps = { seasons: readonly SeasonEntry[] }

/**
 * A TV library's seasons as posters, each its show's, that open the season's
 * page: its name, then its show and how many of its episodes are on disk.
 */
export const SeasonGrid = ({ seasons }: SeasonGridProps) => (
  <ul className={styles.grid} aria-label={SEASON_GRID_COPY.label}>
    {seasons.map(({ show, season, episodes }) => (
      <PosterTitleCard
        key={`${show.id}-${season}`}
        poster={show}
        to={seasonPath({ showId: show.id, season })}
        title={seasonName(season)}
        facts={[show.title, COMMON_COPY.episodes(episodes.length)]}
      />
    ))}
  </ul>
)

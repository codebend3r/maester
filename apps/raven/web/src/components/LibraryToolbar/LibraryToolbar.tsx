import {
  type LibrarySettings,
  type LibraryView,
  type MediaGroupBy,
  type MediaSort,
  groupingsFor,
  isMediaGroupBy,
  isMediaSort,
  sortsFor,
  viewsFor,
} from '@raven/core'
import { useId } from 'react'
import { Button } from '@/components/Button/Button'
import type { IconName } from '@/components/Icon/Icon'
import styles from '@/components/LibraryToolbar/LibraryToolbar.module.scss'

const SORTS: Record<MediaSort, string> = {
  title: 'Title',
  added: 'Recently added',
  oldest: 'Oldest added',
  changed: 'Recently changed',
  largest: 'Largest file',
  smallest: 'Smallest file',
  'bitrate-high': 'Highest bitrate',
  'bitrate-low': 'Lowest bitrate',
  'resolution-high': 'Highest resolution',
  'resolution-low': 'Lowest resolution',
  'year-new': 'Newest release',
  'year-old': 'Oldest release',
  'rating-high': 'Highest rated',
  'rating-low': 'Lowest rated',
  random: 'Random',
}

const VIEWS: Record<LibraryView, { label: string; icon: IconName }> = {
  grid: { label: 'Grid', icon: 'grid' },
  list: { label: 'List', icon: 'list' },
  tiles: { label: 'Tiles', icon: 'tiles' },
  grouped: { label: 'Grouped', icon: 'grouped' },
}

const GROUPINGS: Record<MediaGroupBy, string> = {
  match: 'Matched or not',
  resolution: 'Resolution',
  codec: 'Video codec',
  month: 'Month added',
}

/**
 * Search, then how the library is ordered and laid out. Sort, view and
 * grouping are the library's own settings, already coherent with its type,
 * so the options are its type's: `onChange` gets just the one that changed.
 * Group by shows only in the grouped view. Play and Shuffle are
 * always there, and wait until there is something to play.
 */
export const LibraryToolbar = ({
  name,
  search,
  onSearch,
  settings,
  onChange,
  playable,
  onPlay,
  onShuffle,
}: {
  name: string
  search: string
  onSearch: (search: string) => void
  settings: LibrarySettings
  onChange: (change: Partial<LibrarySettings>) => void
  playable: boolean
  onPlay: () => void
  onShuffle: () => void
}) => {
  const ids = { search: useId(), sort: useId(), group: useId() }
  return (
    <search className={styles.toolbar}>
      <div className={styles.search}>
        <label htmlFor={ids.search} className="visually-hidden">
          Search {name}
        </label>
        <input
          id={ids.search}
          type="search"
          className={styles.input}
          placeholder={`Search ${name}`}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>

      <div className={styles.options}>
        <div className={styles.field}>
          <label htmlFor={ids.sort} className={styles.label}>
            Sort
          </label>
          <select
            id={ids.sort}
            className={styles.select}
            value={settings.sort}
            onChange={(event) =>
              isMediaSort(event.target.value) && onChange({ sort: event.target.value })
            }
          >
            {sortsFor(settings.kind).map((sort) => (
              <option key={sort} value={sort}>
                {SORTS[sort]}
              </option>
            ))}
          </select>
        </div>
        {settings.view === 'grouped' && (
          <div className={styles.field}>
            <label htmlFor={ids.group} className={styles.label}>
              Group by
            </label>
            <select
              id={ids.group}
              className={styles.select}
              value={settings.groupBy}
              onChange={(event) =>
                isMediaGroupBy(event.target.value) && onChange({ groupBy: event.target.value })
              }
            >
              {groupingsFor(settings.kind).map((grouping) => (
                <option key={grouping} value={grouping}>
                  {GROUPINGS[grouping]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={styles.play}>
          <Button tone="primary" icon="play" disabled={!playable} onClick={onPlay}>
            Play
          </Button>
          <Button icon="shuffle" disabled={!playable} onClick={onShuffle}>
            Shuffle
          </Button>
        </div>
      </div>

      <fieldset className={styles.views}>
        <legend className="visually-hidden">View</legend>
        {viewsFor(settings.kind).map((view) => (
          <Button
            key={view}
            icon={VIEWS[view].icon}
            className={styles.view}
            aria-label={VIEWS[view].label}
            title={VIEWS[view].label}
            aria-pressed={settings.view === view}
            onClick={() => onChange({ view })}
          />
        ))}
      </fieldset>
    </search>
  )
}

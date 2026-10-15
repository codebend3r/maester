import {
  type DirectedSortFieldName,
  type LibrarySettings,
  type LibraryView,
  type LibraryViewChange,
  type MediaGroupBy,
  type SortDirection,
  type SortFieldName,
  groupingsFor,
  isMediaGroupBy,
  isSortFieldName,
  reversedDirection,
  reversedSort,
  sortFieldsFor,
  sortParts,
  startingSort,
  viewsFor,
} from '@raven/core'
import { useId } from 'react'
import { Button } from '@/components/Button/Button'
import type { IconName } from '@/components/Icon/Icon'
import { SearchField } from '@/components/SearchField/SearchField'
import type { Search } from '@/lib/useSearch'
import styles from '@/components/LibraryToolbar/LibraryToolbar.module.scss'

const FIELDS: Record<SortFieldName, string> = {
  title: 'Title',
  added: 'Date added',
  changed: 'Date changed',
  size: 'File size',
  bitrate: 'Bitrate',
  resolution: 'Resolution',
  release: 'Release date',
  rating: 'Rating',
  random: 'Random',
}

/** How each way a field runs reads: A to Z, newest first. */
const DIRECTIONS: Record<DirectedSortFieldName, Record<SortDirection, string>> = {
  title: { ascending: 'A to Z', descending: 'Z to A' },
  added: { ascending: 'Oldest first', descending: 'Newest first' },
  changed: { ascending: 'Oldest first', descending: 'Newest first' },
  size: { ascending: 'Smallest first', descending: 'Largest first' },
  bitrate: { ascending: 'Lowest first', descending: 'Highest first' },
  resolution: { ascending: 'Lowest first', descending: 'Highest first' },
  release: { ascending: 'Oldest first', descending: 'Newest first' },
  rating: { ascending: 'Lowest first', descending: 'Highest first' },
}

/**
 * The button beside the sort that turns the order around, saying which way
 * it runs now; a field with no direction, as Random, has none.
 */
const DirectionButton = ({
  settings,
  onChange,
}: {
  settings: LibrarySettings
  onChange: (change: LibraryViewChange) => void
}) => {
  const { field, direction } = sortParts(settings.sort)
  if (direction === null) return null
  const labels = DIRECTIONS[field]
  return (
    <Button
      icon={direction}
      title={`Sort ${labels[reversedDirection(direction)].toLowerCase()} instead`}
      onClick={() => onChange({ sort: reversedSort(settings.sort) })}
    >
      <span className="visually-hidden">Order: </span>
      {labels[direction]}
    </Button>
  )
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
 * Search, then how the library is ordered and laid out: what it is sorted
 * on, and beside it which way, where that means something. Sort, view and
 * grouping are the library's own settings, already coherent with its type,
 * so the options are its type's: `onChange` gets just the one that changed.
 * Group by shows only in the grouped view. Play and Shuffle are
 * always there, and wait until there is something to play.
 */
export const LibraryToolbar = ({
  name,
  search,
  settings,
  onChange,
  playable,
  onPlay,
  onShuffle,
}: {
  name: string
  search: Search
  settings: LibrarySettings
  onChange: (change: LibraryViewChange) => void
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
        <SearchField
          id={ids.search}
          search={search}
          className={styles.input}
          placeholder={`Search ${name}`}
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
            value={sortParts(settings.sort).field}
            onChange={(event) =>
              isSortFieldName(event.target.value) &&
              onChange({ sort: startingSort(event.target.value) })
            }
          >
            {sortFieldsFor(settings.kind).map((field) => (
              <option key={field} value={field}>
                {FIELDS[field]}
              </option>
            ))}
          </select>
          <DirectionButton settings={settings} onChange={onChange} />
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

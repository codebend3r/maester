import {
  GROUPING_LABELS,
  LIBRARY_VIEWS,
  LIBRARY_VIEW_LABELS,
  type LibrarySettings,
  type LibraryView,
  type LibraryViewChange,
  SORT_DIRECTION_LABELS,
  SORT_FIELD_LABELS,
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
import { Button, Icon } from '@raven/ui'
import type { IconName } from '@raven/ui'
import { SearchField } from '@/components/SearchField/SearchField'
import { SelectButton } from '@/components/SelectButton/SelectButton'
import type { Search } from '@raven/ui/headless'
import { LIBRARY_TOOLBAR_COPY } from '@/components/LibraryToolbar/copy'
import styles from '@/components/LibraryToolbar/LibraryToolbar.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type DirectionButtonProps = {
  sort: LibrarySettings['sort']
  onChange: (change: LibraryViewChange) => void
}

type DirectedSortParts = Exclude<ReturnType<typeof sortParts>, { direction: null }>

type DirectionButtonShownProps = DirectionButtonProps & { parts: DirectedSortParts }

/**
 * The button beside the sort that turns the order around, saying which way
 * it runs now; a field with no direction, as Random, has none.
 */
const DirectionButtonShown = ({ sort, parts, onChange }: DirectionButtonShownProps) => {
  const { field, direction } = parts
  const labels = SORT_DIRECTION_LABELS[field]
  return (
    <Button
      tone="ghost"
      icon={direction}
      className={styles.direction}
      title={LIBRARY_TOOLBAR_COPY.sortInstead(labels[reversedDirection(direction)])}
      onClick={() => onChange({ sort: reversedSort(sort) })}
    >
      <span className="visually-hidden">{LIBRARY_TOOLBAR_COPY.order}</span>
      {labels[direction]}
    </Button>
  )
}

const DirectionButton = ({ sort, onChange }: DirectionButtonProps) => {
  const parts = sortParts(sort)
  return (
    parts.direction !== null && (
      <DirectionButtonShown sort={sort} parts={parts} onChange={onChange} />
    )
  )
}

const VIEW_ICONS = {
  [LIBRARY_VIEWS.grid]: 'grid',
  [LIBRARY_VIEWS.covers]: 'covers',
  [LIBRARY_VIEWS.list]: 'list',
  [LIBRARY_VIEWS.tiles]: 'tiles',
  [LIBRARY_VIEWS.grouped]: 'grouped',
} as const satisfies Record<LibraryView, IconName>

type LibraryToolbarProps = {
  name: string
  search: Search
  settings: LibrarySettings
  onChange: (change: LibraryViewChange) => void
  playable: boolean
  onPlay: () => void
  onShuffle: () => void
}

/**
 * Two rows: search, then what the library is sorted on and beside it which
 * way, where that means something, and the grouping in the grouped view;
 * under them Play, Shuffle and Select, and at the far end the views as one
 * segmented control. Sort, view and grouping are the library's own
 * settings, already coherent with its type, so the options are its type's:
 * `onChange` gets just the one that changed. Play and Shuffle are always
 * there, and wait until there is something to play; Select starts select
 * mode in the scope the toolbar sits in.
 */
export const LibraryToolbar = ({
  name,
  search,
  settings,
  onChange,
  playable,
  onPlay,
  onShuffle,
}: LibraryToolbarProps) => {
  const ids = { search: useId(), sort: useId(), group: useId() }
  return (
    <search className={styles.toolbar}>
      <div className={styles.find}>
        <div className={styles.search}>
          <label htmlFor={ids.search} className="visually-hidden">
            {LIBRARY_TOOLBAR_COPY.search(name)}
          </label>
          <span className={styles.searchIcon}>
            <Icon name="search" size={18} />
          </span>
          <SearchField
            id={ids.search}
            search={search}
            className={styles.input}
            placeholder={LIBRARY_TOOLBAR_COPY.search(name)}
          />
        </div>

        <div className={`${styles.picker} ${styles.sort}`}>
          <label htmlFor={ids.sort} className={styles.label}>
            {COMMON_COPY.sort}
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
                {SORT_FIELD_LABELS[field]}
              </option>
            ))}
          </select>
        </div>
        <DirectionButton sort={settings.sort} onChange={onChange} />

        {settings.view === LIBRARY_VIEWS.grouped && (
          <div className={`${styles.picker} ${styles.group}`}>
            <label htmlFor={ids.group} className={styles.label}>
              {LIBRARY_TOOLBAR_COPY.groupBy}
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
                  {GROUPING_LABELS[grouping]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className={styles.act}>
        <div className={styles.play}>
          <Button tone="primary" icon="play" disabled={!playable} onClick={onPlay}>
            {COMMON_COPY.play}
          </Button>
          <Button icon="shuffle" disabled={!playable} onClick={onShuffle}>
            {COMMON_COPY.shuffle}
          </Button>
          <SelectButton />
        </div>

        <fieldset className={styles.views}>
          <legend className="visually-hidden">{LIBRARY_TOOLBAR_COPY.view}</legend>
          {viewsFor(settings.kind).map((view) => (
            <Button
              key={view}
              tone="ghost"
              icon={VIEW_ICONS[view]}
              className={styles.view}
              aria-label={LIBRARY_VIEW_LABELS[view]}
              title={LIBRARY_VIEW_LABELS[view]}
              aria-pressed={settings.view === view}
              onClick={() => onChange({ view })}
            />
          ))}
        </fieldset>
      </div>
    </search>
  )
}

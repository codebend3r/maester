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
  isLibraryView,
  isMediaGroupBy,
  isSortFieldName,
  reversedDirection,
  reversedSort,
  sortFieldsFor,
  sortParts,
  startingSort,
  viewsFor,
} from '@raven/core'
import { type ReactNode, useId } from 'react'
import { BUTTON_TONES, Button, Icon, classNames } from '@raven/ui'
import type { IconName } from '@raven/ui'
import { PlayButtons } from '@/components/PlayButtons/PlayButtons'
import { SearchField } from '@/components/SearchField/SearchField'
import { SelectButton } from '@/components/SelectButton/SelectButton'
import type { Search } from '@raven/ui/headless'
import { LIBRARY_TOOLBAR_COPY } from '@/components/LibraryToolbar/copy'
import styles from '@/components/LibraryToolbar/LibraryToolbar.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { SHOW_LEVELS, type ShowLevel, isShowLevel } from '@/lib/showLevels'

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
      tone={BUTTON_TONES.ghost}
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

type ToolbarPickerProps<T extends string> = {
  /** Where the toolbar's grid places it. */
  className: string | undefined
  /** What a phone shows in place of its words; Sort and the level keep their words. */
  icon?: IconName
  label: string
  value: T
  options: readonly T[]
  labels: Readonly<Record<T, string>>
  isOption: (value: string) => value is T
  onPick: (value: T) => void
}

/** One of the toolbar's labelled choices: the sort, the view, the grouping or the level. */
const ToolbarPicker = <T extends string>({
  className,
  icon,
  label,
  value,
  options,
  labels,
  isOption,
  onPick,
}: ToolbarPickerProps<T>) => {
  const id = useId()
  return (
    <div className={classNames([styles.picker, className])}>
      {!!icon && (
        <span className={styles.pickerIcon} aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
      )}
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        onChange={(event) => isOption(event.target.value) && onPick(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </div>
  )
}

type ShowLevelPickerProps = { level: ShowLevel; onChange: (level: ShowLevel) => void }

/**
 * A TV library's choice of what its page lists: its shows, their seasons or
 * their episodes. It stands where the grouping would, which a TV library never has.
 */
export const ShowLevelPicker = ({ level, onChange }: ShowLevelPickerProps) => (
  <ToolbarPicker
    className={styles.level}
    label={LIBRARY_TOOLBAR_COPY.showBy}
    value={level}
    options={Object.values(SHOW_LEVELS)}
    labels={LIBRARY_TOOLBAR_COPY.levels}
    isOption={isShowLevel}
    onPick={onChange}
  />
)

type LibraryToolbarProps = {
  name: string
  search: Search
  settings: LibrarySettings
  onChange: (change: LibraryViewChange) => void
  playable: boolean
  onPlay: () => void
  onShuffle: () => void
  /** More pickers after the sort, as a TV library's `ShowLevelPicker`. */
  children?: ReactNode
}

/**
 * Two rows: search, then what the library is sorted on and beside it which
 * way, where that means something, and the grouping in the grouped view;
 * under them Play, Shuffle and Select, and at the far end the views as one
 * segmented control. On a phone they are the phone app's chips: the search
 * as an underline, then Shuffle, Sort with its word and choice, the
 * direction, Play, Select and the views, every one but Sort its icon alone,
 * and the grouping as its icon. Sort, view and grouping are the library's own
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
  children,
}: LibraryToolbarProps) => {
  const searchId = useId()
  return (
    <search className={styles.toolbar}>
      <div className={styles.find}>
        <div className={styles.search}>
          <label htmlFor={searchId} className="visually-hidden">
            {LIBRARY_TOOLBAR_COPY.search(name)}
          </label>
          <span className={styles.searchIcon}>
            <Icon name="search" size={18} />
          </span>
          <SearchField
            id={searchId}
            search={search}
            className={styles.input}
            placeholder={LIBRARY_TOOLBAR_COPY.search(name)}
          />
        </div>

        <ToolbarPicker
          className={styles.sort}
          label={COMMON_COPY.sort}
          value={sortParts(settings.sort).field}
          options={sortFieldsFor(settings.kind)}
          labels={SORT_FIELD_LABELS}
          isOption={isSortFieldName}
          onPick={(field) => onChange({ sort: startingSort(field) })}
        />
        <DirectionButton sort={settings.sort} onChange={onChange} />
        {/* A phone's view chip, the phone app's one picker in place of the row of views. */}
        <ToolbarPicker
          className={styles.viewPicker}
          icon={VIEW_ICONS[settings.view]}
          label={LIBRARY_TOOLBAR_COPY.view}
          value={settings.view}
          options={viewsFor(settings.kind)}
          labels={LIBRARY_VIEW_LABELS}
          isOption={isLibraryView}
          onPick={(view) => onChange({ view })}
        />
        {children}

        {settings.view === LIBRARY_VIEWS.grouped && (
          <ToolbarPicker
            className={styles.group}
            icon={VIEW_ICONS[LIBRARY_VIEWS.grouped]}
            label={LIBRARY_TOOLBAR_COPY.groupBy}
            value={settings.groupBy}
            options={groupingsFor(settings.kind)}
            labels={GROUPING_LABELS}
            isOption={isMediaGroupBy}
            onPick={(groupBy) => onChange({ groupBy })}
          />
        )}
      </div>

      <div className={styles.act}>
        <div className={styles.play}>
          <PlayButtons playable={playable} onPlay={onPlay} onShuffle={onShuffle} />
          <SelectButton />
        </div>

        <fieldset className={styles.views}>
          <legend className="visually-hidden">{LIBRARY_TOOLBAR_COPY.view}</legend>
          {viewsFor(settings.kind).map((view) => (
            <Button
              key={view}
              tone={BUTTON_TONES.ghost}
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

import {
  GROUPING_LABELS,
  LIBRARY_VIEW_LABELS,
  LIBRARY_VIEWS,
  type Library as LibraryRecord,
  type LibrarySettings,
  type LibraryView,
  type MediaItem,
  SORT_DIRECTION_LABELS,
  SORT_FIELD_LABELS,
  groupingsFor,
  reversedSort,
  sortFieldsFor,
  sortParts,
  startingSort,
} from '@raven/core'
import type { IconName } from '@raven/ui/iconDrawings'
import { useRouter } from 'expo-router'

import { Picker, ToolButton } from '@/layouts'
import { hrefOf } from '@/routes'
import { LIBRARY_COPY } from '@/screens/copy'
import { shuffleDeal } from '@/screens/shuffleDeal'
import { appViewsFor } from '@/screens/useLibraryView'
import type { LibraryChoice } from '@/stores/libraryViews'
import { useVideoQueue } from '@/stores/videoQueue'
import { APP_ICONS } from '@/theme/icons'

/** What each view's chip draws beside its name: the web's icons for the views. */
const VIEW_ICONS = {
  [LIBRARY_VIEWS.grid]: APP_ICONS.grid,
  [LIBRARY_VIEWS.covers]: APP_ICONS.covers,
  [LIBRARY_VIEWS.list]: APP_ICONS.list,
  [LIBRARY_VIEWS.tiles]: APP_ICONS.tiles,
  [LIBRARY_VIEWS.grouped]: APP_ICONS.grouped,
} as const satisfies Record<LibraryView, IconName>

type ShuffleButtonProps = { library: LibraryRecord; choices: readonly MediaItem[] }

/**
 * Shuffle, first after the way to the other page: `choices` dealt into the device's video queue
 * and the first of them played from where it was left, the player's Next and back walking the
 * rest of the deal.
 */
export const ShuffleButton = ({ library, choices }: ShuffleButtonProps) => {
  const router = useRouter()
  const start = useVideoQueue((queue) => queue.start)
  return (
    <ToolButton
      accessibilityLabel={LIBRARY_COPY.shuffleLibrary(library.name)}
      icon={APP_ICONS.shuffle}
      label={LIBRARY_COPY.shuffle}
      onPress={() => {
        const { queue, target } = shuffleDeal({ choices })
        if (target === null) return
        start(queue)
        router.push(hrefOf(target))
      }}
    />
  )
}

type LibraryToolbarProps = {
  settings: LibrarySettings
  onChange: (change: LibraryChoice) => void
}

/**
 * Sort, its direction, view and, in the grouped view, the grouping, as the web's toolbar
 * offers them: each the library's type's own, so a sort it cannot use is never offered. Under
 * the thumb only Sort shows its word and its value; the rest are their icons alone.
 */
export const LibraryToolbar = ({ settings, onChange }: LibraryToolbarProps) => {
  const parts = sortParts(settings.sort)
  return (
    <>
      <Picker
        icon={APP_ICONS.ascending}
        label={LIBRARY_COPY.sort}
        onChoose={(field) => onChange({ sort: startingSort(field) })}
        options={sortFieldsFor(settings.kind).map((field) => ({
          key: field,
          label: SORT_FIELD_LABELS[field],
        }))}
        value={parts.field}
      />
      {parts.direction !== null && (
        <ToolButton
          accessibilityLabel={LIBRARY_COPY.order(
            SORT_DIRECTION_LABELS[parts.field][parts.direction],
          )}
          icon={parts.direction}
          label={SORT_DIRECTION_LABELS[parts.field][parts.direction]}
          onPress={() => onChange({ sort: reversedSort(settings.sort) })}
        />
      )}
      <Picker
        icon={VIEW_ICONS[settings.view]}
        isIconOnly
        label={LIBRARY_COPY.view}
        onChoose={(view) => onChange({ view })}
        options={appViewsFor(settings.kind).map((view) => ({
          key: view,
          label: LIBRARY_VIEW_LABELS[view],
        }))}
        value={settings.view}
      />
      {settings.view === LIBRARY_VIEWS.grouped && (
        <Picker
          icon={APP_ICONS.grouped}
          isIconOnly
          label={LIBRARY_COPY.groupBy}
          onChoose={(groupBy) => onChange({ groupBy })}
          options={groupingsFor(settings.kind).map((grouping) => ({
            key: grouping,
            label: GROUPING_LABELS[grouping],
          }))}
          value={settings.groupBy}
        />
      )}
    </>
  )
}

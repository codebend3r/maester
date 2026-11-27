import {
  LIBRARY_ICONS,
  LIBRARY_LABELS,
  LIBRARY_ORDER,
  type LibrarySegment,
  type WrenIconName,
} from '@raven/wren'

/** One of Library's categories: its kind, its name and its drawing. */
export type Category = { kind: LibrarySegment; label: string; icon: WrenIconName }

/**
 * Library's categories in the order Library and the tablet's sidebar list them: raven's seven
 * music tabs in raven's order, then Songs and Downloads.
 */
export const CATEGORIES: readonly Category[] = LIBRARY_ORDER.map((kind) => ({
  kind,
  label: LIBRARY_LABELS[kind],
  icon: LIBRARY_ICONS[kind],
}))

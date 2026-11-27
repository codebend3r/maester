import {
  LIBRARY_ICONS,
  LIBRARY_LABELS,
  SHARED_ORDER,
  type SharedSegment,
  type WrenIconName,
} from '@raven/wren'

/** One of Library's categories: its kind, its name and its drawing. */
type Category = { kind: SharedSegment; label: string; icon: WrenIconName }

/**
 * Library's categories in Library's order: raven's seven music tabs in raven's order, then
 * Songs. A TV keeps no downloads, so Downloads is left out, as on the web.
 */
export const CATEGORIES: readonly Category[] = SHARED_ORDER.map((kind) => ({
  kind,
  label: LIBRARY_LABELS[kind],
  icon: LIBRARY_ICONS[kind],
}))

import type { WrenIconName } from '@raven/wren'

/** A press with its icon and its words: a sheet's action, a field's button. */
export type IconAction = { icon: WrenIconName; label: string; onPress: () => void }

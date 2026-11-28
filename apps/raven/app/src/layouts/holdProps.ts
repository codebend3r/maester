import { holdActionPropsOf } from '@raven/native/headless'
import type { PressableProps } from 'react-native'

import type { TouchCard } from '@/cardMenu/touchCard'
import { MUSIC_COPY } from '@/layouts/copy'

/** What a long press on a control does, and how the screen reader is told of it. */
export type Hold = { label: string; hint: string; onHold: () => void }

type HoldProps = ReturnType<typeof holdActionPropsOf> & Pick<PressableProps, 'onLongPress'>

/** The long press and the screen reader's action for it, or nothing for a control with no hold. */
export const holdPropsOf = (hold: Hold | undefined): HoldProps =>
  hold === undefined ? {} : { ...holdActionPropsOf(hold), onLongPress: hold.onHold }

/** A cover's long press, with the screen reader's word for it; none when the cover has no menu. */
export const coverHoldOf = ({ onLongPress }: TouchCard): Hold | undefined =>
  onLongPress === undefined
    ? undefined
    : { label: MUSIC_COPY.coverHoldAction, hint: MUSIC_COPY.coverHoldHint, onHold: onLongPress }

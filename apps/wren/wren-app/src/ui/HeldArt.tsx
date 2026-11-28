import { holdActionPropsOf } from '@raven/native/headless'
import { COVER_MENU_COPY } from '@raven/wren'
import { Pressable } from 'react-native'

import { AlbumArt, type AlbumArtProps } from '@/ui/AlbumArt'
import { pressedStyleOf } from '@/ui/press'

/** What a test finds a cover that holds its menu by, since the screen reader reads it through its row or tile. */
export const HELD_COVER_TEST_ID = 'held-cover'

/** What holding a cover does; undefined for one with nothing to hold. */
type CoverHold = (() => void) | undefined

/**
 * The screen reader's long press for the element that reads a held cover out, in the cover
 * menu's words; nothing when `onHold` is undefined.
 */
export const coverHoldPropsOf = (onHold: CoverHold): ReturnType<typeof holdActionPropsOf> =>
  holdActionPropsOf({ label: COVER_MENU_COPY.holdAction, hint: COVER_MENU_COPY.holdHint, onHold })

type HeldArtProps = AlbumArtProps & {
  /** What a long press on the cover does: its menu. */
  onHold: () => void
  /** What a short tap does: the press of the row or tile it sits in, since the cover takes the touch from it. */
  onPress: () => void
}

/**
 * A cover that opens its menu on a long press, the placeholder of a cover-less album alike, and
 * hands a short tap on to what holds it. The screen reader is offered the menu by the element
 * that reads the cover out (`coverHoldPropsOf`), so this answers the finger alone.
 */
export function HeldArt({ onHold, onPress, ...art }: HeldArtProps) {
  return (
    <Pressable
      accessible={false}
      onLongPress={onHold}
      onPress={onPress}
      style={pressedStyleOf({ style: null })}
      testID={HELD_COVER_TEST_ID}
    >
      <AlbumArt {...art} />
    </Pressable>
  )
}

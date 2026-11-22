import { KEYS } from '@raven/core'
import { useKeyShortcut } from '@raven/ui'
import { hasPlayingTrackOf, useAudioQueue } from '@raven/ui/headless'

/** What presses itself on Space, so the page leaves the key to it: a button, a link, a slider. */
const PRESSED_BY_SPACE = 'button, a, summary, [role="button"], [role="slider"], [role="menuitem"]'

const isPressedBySpace = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(PRESSED_BY_SPACE) !== null

/**
 * Space plays and pauses the queue from anywhere on the page, as it does in raven's player. A
 * form control, a dialog, and a button, link or slider with focus keep Space for themselves.
 */
export const usePlayPauseKey = (): void => {
  const hasTrack = useAudioQueue(hasPlayingTrackOf)
  const toggle = useAudioQueue((store) => store.toggle)
  useKeyShortcut({
    key: KEYS.space,
    onPress: toggle,
    isEnabled: hasTrack,
    keepsKey: isPressedBySpace,
  })
}

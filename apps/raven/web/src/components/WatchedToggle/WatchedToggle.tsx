import { WATCHED_STATES, type WatchedState } from '@raven/core'
import { Button, classNames } from '@raven/ui'
import type { PhoneWatchedWords } from '@/components/WatchedToggle/copy'
import styles from '@/components/WatchedToggle/WatchedToggle.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const PRESSED = { unwatched: false, partly: 'mixed', watched: true } as const satisfies Record<
  WatchedState,
  boolean | 'mixed'
>

/** Which of a page's phone words the mark shows: what pressing it does, until all of it is watched. */
const PHONE_WORD_OF = {
  [WATCHED_STATES.unwatched]: 'mark',
  [WATCHED_STATES.partly]: 'mark',
  [WATCHED_STATES.watched]: 'marked',
} as const satisfies Record<WatchedState, keyof PhoneWatchedWords>

type WatchedToggleProps = {
  state: WatchedState
  onToggle: () => void
  label?: string
  /** Whether the label shows beside the check; a header's toggle is the check alone. */
  isLabelShown?: boolean
  /**
   * The words a page's header shows beside the check on a phone, as the phone
   * app's Watched does: what pressing it marks, then that it is.
   */
  phoneWords?: PhoneWatchedWords
  className?: string
}

/**
 * The Watched button of a page or an episode row. `partly` reads as
 * `mixed`: pressing it marks everything watched, and pressing it again
 * everything unwatched. `label` is the name a screen reader hears; the
 * button is its check alone, `label` its hover title, unless `isLabelShown`.
 */
export const WatchedToggle = ({
  state,
  onToggle,
  label = COMMON_COPY.watched,
  isLabelShown = false,
  phoneWords,
  className,
}: WatchedToggleProps) => (
  <Button
    icon="check"
    aria-label={isLabelShown ? undefined : label}
    aria-pressed={PRESSED[state]}
    data-phone-words={phoneWords && phoneWords[PHONE_WORD_OF[state]]}
    className={classNames([styles.toggle, className])}
    onClick={onToggle}
  >
    {isLabelShown && label}
  </Button>
)

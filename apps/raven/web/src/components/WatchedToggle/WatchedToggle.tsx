import type { WatchedState } from '@raven/core'
import { Button } from '@raven/ui'
import styles from '@/components/WatchedToggle/WatchedToggle.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const PRESSED = { unwatched: false, partly: 'mixed', watched: true } as const satisfies Record<
  WatchedState,
  boolean | 'mixed'
>

type WatchedToggleProps = {
  state: WatchedState
  onToggle: () => void
  label?: string
  isLabelShown?: boolean
  className?: string
}

/**
 * The Watched button of a page or an episode row. `partly` reads as
 * `mixed`: pressing it marks everything watched, and pressing it again
 * everything unwatched. `label` is the name a screen reader hears, and is
 * shown unless the button is only its check.
 */
export const WatchedToggle = ({
  state,
  onToggle,
  label = COMMON_COPY.watched,
  isLabelShown = true,
  className,
}: WatchedToggleProps) => (
  <Button
    icon="check"
    aria-label={isLabelShown ? undefined : label}
    aria-pressed={PRESSED[state]}
    className={[styles.toggle, className ?? ''].filter(Boolean).join(' ')}
    onClick={onToggle}
  >
    {isLabelShown && label}
  </Button>
)

import { TOUCH_HOLD_RATE, type TouchSide } from '@raven/core'
import { Icon } from '@/components/Icon/Icon'
import type { IconName } from '@/components/Icon/drawings'
import styles from '@/components/Player/Bezel.module.scss'
import { PLAYER_ACTIONS_COPY } from '@/components/Player/copy'

export type BezelState = { id: number; icon: IconName; text: string }

type BezelProps = { bezel: BezelState }

/**
 * The flash in the middle of the picture after a key or click: what just
 * happened, fading as it grows. Render it keyed by `id`, so a repeat restarts it.
 * Decorative: the player announces the same text in a live region.
 */
export const Bezel = ({ bezel }: BezelProps) => (
  <div className={styles.bezel} aria-hidden="true">
    <Icon name={bezel.icon} size={36} />
    <span className={styles.text}>{bezel.text}</span>
  </div>
)

type HoldLook = { icon: IconName; label: string }

/** What a held finger does on each side of the picture: back on the left, on at speed on the right. */
export const HOLD_LOOKS = {
  [-1]: { icon: 'rewind', label: PLAYER_ACTIONS_COPY.holdBack(TOUCH_HOLD_RATE) },
  [1]: { icon: 'forward', label: PLAYER_ACTIONS_COPY.holdForward(TOUCH_HOLD_RATE) },
} as const satisfies Record<TouchSide, HoldLook>

type HoldMarkProps = { side: TouchSide }

/**
 * What a finger held on the picture is doing, at the top of it for as long as it is held, clear
 * of the picture's middle. Decorative: the player announces the same in a live region.
 */
export const HoldMark = ({ side }: HoldMarkProps) => (
  <div className={styles.held} aria-hidden="true">
    <Icon name={HOLD_LOOKS[side].icon} size={20} />
    <span className={styles.text}>{PLAYER_ACTIONS_COPY.rate(TOUCH_HOLD_RATE)}</span>
  </div>
)

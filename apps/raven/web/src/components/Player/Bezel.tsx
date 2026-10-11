import { Icon, type IconName } from '@/components/Icon/Icon'
import styles from '@/components/Player/Bezel.module.scss'

export type BezelState = { id: number; icon: IconName; text: string }

/**
 * The flash in the middle of the picture after a key or click: what just
 * happened, fading as it grows. Render it keyed by `id`, so a repeat restarts it.
 * Decorative: the player announces the same text in a live region.
 */
export const Bezel = ({ bezel }: { bezel: BezelState }) => (
  <div className={styles.bezel} aria-hidden="true">
    <Icon name={bezel.icon} size={30} />
    <span className={styles.text}>{bezel.text}</span>
  </div>
)

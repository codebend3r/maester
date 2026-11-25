import { SIZES } from '@/theme/tokens'
import { Button, type ButtonVariant } from '@/ui/Button/Button'
import type { IconAction, WrenIconName } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/EmptyState/EmptyState.module.scss'

/** The button an empty state offers: New playlist, Clear search. */
type EmptyAction = Omit<IconAction, 'icon'> & { variant?: ButtonVariant }

type EmptyStateProps = {
  icon: WrenIconName
  title: string
  body: string
  action?: EmptyAction
}

/** What a list says when it holds nothing: an icon, a heading, what to do, and a button to do it. */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <section className={styles.empty}>
      <span className={styles.tile}>
        <WrenIcon name={icon} size={SIZES.emptyIcon} />
      </span>
      <div className={styles.text}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
      </div>
      {action !== undefined && <Button {...action} />}
    </section>
  )
}

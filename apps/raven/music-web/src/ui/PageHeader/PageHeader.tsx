import type { ReactNode } from 'react'
import { BackLink } from '@/ui/BackLink/BackLink'
import type { Press } from '@/ui/Pressable/Pressable'
import styles from '@/ui/PageHeader/PageHeader.module.scss'

/** The page a page was opened from, and the way back to it. */
type BackTarget = Press & { label: string }

type PageHeaderProps = {
  title: string
  /** "< Library" above the title, on a page opened from another. */
  back?: BackTarget
  /** What sits at the title's end: search, sort, New playlist. */
  actions?: ReactNode
}

/** The way back, named for the page it returns to. */
function BackTo({ label, ...press }: BackTarget) {
  return <BackLink {...press} to={label} />
}

/** A page's large Young Serif title, the way back above it and its actions beside it. */
export function PageHeader({ title, back, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {back !== undefined && <BackTo {...back} />}
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{title}</h1>
        {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  )
}

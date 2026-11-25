import type { ReactNode } from 'react'
import { BackLink, type BackTarget } from '@/ui/BackLink/BackLink'
import styles from '@/ui/PageHeader/PageHeader.module.scss'

type PageHeaderProps = {
  title: string
  /** "< Library" above the title, on a page opened from another. */
  back?: BackTarget
  /** What sits at the title's end: search, sort, New playlist. */
  actions?: ReactNode
}

/** A page's large Young Serif title, the way back above it and its actions beside it. */
export function PageHeader({ title, back, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {back !== undefined && <BackLink {...back} />}
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{title}</h1>
        {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  )
}

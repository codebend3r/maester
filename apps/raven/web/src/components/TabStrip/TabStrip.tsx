import { Icon, type IconName } from '@raven/ui'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useIsCurrent } from '@/components/AppShell/currentPage'
import styles from '@/components/TabStrip/TabStrip.module.scss'

type TabStripProps = {
  label: string
  children: ReactNode
}

/** A phone's tab bar, along the foot of the screen in a shell's side menu's place. */
export const TabStrip = ({ label, children }: TabStripProps) => (
  <nav className={styles.tabs} aria-label={label}>
    {children}
  </nav>
)

type TabProps = {
  to: string
  patterns: readonly string[]
  icon: IconName
  label: string
  /** What a screen reader calls it, where its short label alone would not say. */
  accessibleName?: string
}

/** A tab: its icon over its name, marked as current when the location matches any of its patterns. */
export const Tab = ({ to, patterns, icon, label, accessibleName }: TabProps) => {
  const isCurrent = useIsCurrent(patterns)
  return (
    <Link
      to={to}
      className={styles.tab}
      aria-label={accessibleName}
      aria-current={isCurrent ? 'page' : undefined}
    >
      <Icon name={icon} size={22} />
      <span className={styles.label}>{label}</span>
    </Link>
  )
}

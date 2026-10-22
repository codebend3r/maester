import type { IconName } from '@raven/ui'
import { type ReactNode, useId } from 'react'
import { Titled } from '@/pages/SettingsPage/Titled'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

/** One of raven player's settings sections, headed and ruled as Settings' own are. */
export const Section = ({
  icon,
  title,
  help,
  children,
}: {
  icon: IconName
  title: string
  help: string
  children: ReactNode
}) => {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon={icon}>{title}</Titled>
        </h2>
        <p className={styles.help}>{help}</p>
      </header>
      {children}
    </section>
  )
}

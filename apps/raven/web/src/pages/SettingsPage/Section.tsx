import type { IconName } from '@raven/ui'
import { type ReactNode, useId } from 'react'
import { Titled } from '@/pages/SettingsPage/Titled'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

type SectionProps = {
  icon: IconName
  title: string
  help: string
  children: ReactNode
}

/** A settings section with a plain heading and help line, for one that reads no settings source. */
export const Section = ({ icon, title, help, children }: SectionProps) => {
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

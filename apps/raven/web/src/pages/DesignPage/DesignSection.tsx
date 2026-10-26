import type { ReactNode } from 'react'
import { type SectionId, sectionNumber, sectionTitle } from '@/pages/DesignPage/contents'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

type DesignSectionProps = {
  id: SectionId
  intro?: ReactNode
  children: ReactNode
}

/**
 * One part of the design page, a landmark named by its heading: its number
 * and title over a hairline, then a line about it.
 */
export const DesignSection = ({ id, intro, children }: DesignSectionProps) => (
  <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
    <header className={styles.sectionHeader}>
      <h2 id={`${id}-title`} className={styles.sectionTitle}>
        <span className={styles.sectionNumber} aria-hidden="true">
          {sectionNumber(id)}
        </span>
        <span>{sectionTitle(id)}</span>
      </h2>
      {!!intro && <p className={styles.intro}>{intro}</p>}
    </header>
    {children}
  </section>
)

type SpecimenProps = {
  name: string
  note?: ReactNode
  isWide?: boolean
  children: ReactNode
}

/**
 * A named example inside a section, as a row: the name and a line about it
 * at the left, the thing itself at the right, a hairline under it.
 * `isWide` puts the name above instead, for a component laid out for a
 * page's whole width, such as a page's header.
 */
export const Specimen = ({ name, note, isWide = false, children }: SpecimenProps) => (
  <div className={isWide ? `${styles.specimen} ${styles.wide}` : styles.specimen}>
    <div className={styles.specimenHeader}>
      <h3 className={styles.specimenName}>{name}</h3>
      {!!note && <p className={styles.note}>{note}</p>}
    </div>
    <div className={styles.specimenBody}>{children}</div>
  </div>
)

import type { ReactNode } from 'react'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

/** One part of the design page, a landmark named by its heading. */
export const DesignSection = ({
  id,
  title,
  intro,
  children,
}: {
  id: string
  title: string
  intro?: ReactNode
  children: ReactNode
}) => (
  <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
    <header className={styles.sectionHeader}>
      <h2 id={`${id}-title`} className={styles.sectionTitle}>
        {title}
      </h2>
      {!!intro && <p className={styles.intro}>{intro}</p>}
    </header>
    {children}
  </section>
)

/** A named example inside a section: the name, an optional line about it, then the thing itself. */
export const Specimen = ({
  name,
  note,
  children,
}: {
  name: string
  note?: ReactNode
  children: ReactNode
}) => (
  <div className={styles.specimen}>
    <div className={styles.specimenHeader}>
      <h3 className={styles.specimenName}>{name}</h3>
      {!!note && <p className={styles.note}>{note}</p>}
    </div>
    <div className={styles.specimenBody}>{children}</div>
  </div>
)

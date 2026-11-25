import type { DesignToken } from '@raven/core'
import type { ReactNode } from 'react'
import { type SectionId, sectionNumber, sectionTitle } from '@/screens/Design/sections'
import styles from '@/screens/Design/Design.module.scss'

type DesignSectionProps = {
  id: SectionId
  intro: string
  children: ReactNode
}

/** One part of the design page, a landmark named by its heading: its number, title and a line. */
export function DesignSection({ id, intro, children }: DesignSectionProps) {
  return (
    <section aria-labelledby={`${id}-title`} className={styles.section} id={id}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle} id={`${id}-title`}>
          <span aria-hidden="true" className={styles.sectionNumber}>
            {sectionNumber({ id })}
          </span>
          <span>{sectionTitle({ id })}</span>
        </h2>
        <p className={styles.intro}>{intro}</p>
      </header>
      {children}
    </section>
  )
}

type SpecimenProps = {
  name: string
  note: string
  children: ReactNode
}

/** A named example in a section, as a row: its name and a line at the left, the thing itself at the right. */
export function Specimen({ name, note, children }: SpecimenProps) {
  return (
    <div className={styles.specimen}>
      <div className={styles.specimenHeader}>
        <h3 className={styles.specimenName}>{name}</h3>
        <p className={styles.note}>{note}</p>
      </div>
      <div className={styles.specimenBody}>{children}</div>
    </div>
  )
}

type TokenLineProps = {
  token: DesignToken
  /** The token drawn at its true size, beside its name and value. */
  children: ReactNode
}

/** One token's row: its name, its value, how it looks, and the line the stylesheet notes it with. */
export function TokenLine({ token, children }: TokenLineProps) {
  return (
    <li className={styles.token}>
      <code className={styles.tokenName}>{token.name}</code>
      <span className={styles.value}>{token.value}</span>
      <span className={styles.sample}>{children}</span>
      {token.note !== null && <span className={styles.note}>{token.note}</span>}
    </li>
  )
}

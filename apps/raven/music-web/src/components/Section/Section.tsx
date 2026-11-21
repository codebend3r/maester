import { classNames } from '@raven/ui/headless'
import type { ComponentProps, ReactNode } from 'react'
import { SectionHeader } from '@/ui/SectionHeader/SectionHeader'
import styles from '@/components/Section/Section.module.scss'

type SectionProps = Pick<ComponentProps<typeof SectionHeader>, 'title' | 'seeAll'> & {
  /** What sets the section apart from a plain one: an artist's keeps the page's side margins itself. */
  className?: string
  /** What sits under the title: a grid, or the notice in its place. */
  children: ReactNode
}

/** A titled part of a page: its header, with See all where there is more, over what it holds. */
export function Section({ title, seeAll, className, children }: SectionProps) {
  return (
    <section className={classNames([styles.section, className])}>
      <SectionHeader seeAll={seeAll} title={title} />
      {children}
    </section>
  )
}

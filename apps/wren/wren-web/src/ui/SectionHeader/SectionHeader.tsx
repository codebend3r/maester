import { KIT_COPY } from '@raven/wren'
import type { Press } from '@/ui/Pressable/Pressable'
import { type TextAction, TextLink } from '@/ui/TextLink/TextLink'
import styles from '@/ui/SectionHeader/SectionHeader.module.scss'

type SectionHeaderProps = {
  title: string
  /** See all: the whole list this section shows the start of. */
  seeAll?: Press
  /** Another link at the title's end: Clear. */
  action?: TextAction
}

/** The link at the title's end: the one asked for, else See all, named for its section. */
const actionOf = ({ title, seeAll, action }: SectionHeaderProps): TextAction | undefined =>
  action ??
  (seeAll === undefined
    ? undefined
    : { ...seeAll, label: KIT_COPY.seeAll, spoken: KIT_COPY.seeAllOf(title) })

/** A section's title over its shelf or rows, and a link at its end: See all, Clear. */
export function SectionHeader({ title, seeAll, action }: SectionHeaderProps) {
  const link = actionOf({ title, seeAll, action })
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      {link !== undefined && <TextLink {...link} />}
    </header>
  )
}

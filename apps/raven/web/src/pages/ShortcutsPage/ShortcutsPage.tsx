import { type ShortcutRow, shortcutRows } from '@raven/core'
import { useId } from 'react'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { useIsDesktop } from '@/stores/desktop'
import { SIDE_MENU_KEY } from '@/stores/sideMenu'
import styles from '@/pages/ShortcutsPage/ShortcutsPage.module.scss'

/** The keys raven's frame answers on any browsing page. */
const FRAME_ROWS: readonly ShortcutRow[] = [
  {
    keys: [SIDE_MENU_KEY.toUpperCase()],
    action: 'Collapse or expand the side menu, on a screen wide enough for it',
  },
]

type ShortcutListProps = { title: string; rows: readonly ShortcutRow[] }

/** A titled list of keys and what each does. */
const ShortcutList = ({ title, rows }: ShortcutListProps) => {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionTitle}>
        {title}
      </h2>
      <dl className={styles.list}>
        {rows.map(({ keys, action }) => (
          <div key={action} className={styles.row}>
            <dt className={styles.keys}>
              {keys.map((key) => (
                <kbd key={key} className={styles.key}>
                  {key}
                </kbd>
              ))}
            </dt>
            <dd className={styles.action}>{action}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * `/shortcuts`: every key the player answers, as its `?` list has them, and
 * the frame's own. Video info is listed only inside Raven, whose player has
 * it. It needs no server, so it opens offline too.
 */
export const ShortcutsPage = () => {
  const titleId = useId()
  const isDesktop = useIsDesktop()
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <PageTitle id={titleId} icon="keyboard">
          Shortcuts
        </PageTitle>
        <p className={styles.intro}>
          Keys that work while a video plays, and around raven. Press <kbd>?</kbd> in the player for
          the same list.
        </p>
      </header>
      <ShortcutList title="While a video plays" rows={shortcutRows({ canShowStats: isDesktop })} />
      <ShortcutList title="Around raven" rows={FRAME_ROWS} />
    </section>
  )
}

import { type ShortcutRow, shortcutRows } from '@raven/core'
import { useId } from 'react'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { useIsDesktop } from '@/stores/desktop'
import { SIDE_MENU_KEY } from '@/stores/sideMenu'
import { SHORTCUTS_COPY } from '@/pages/ShortcutsPage/copy'
import styles from '@/pages/ShortcutsPage/ShortcutsPage.module.scss'

/** The keys raven's frame answers on any browsing page. */
const FRAME_ROWS: readonly ShortcutRow[] = [
  {
    keys: [SIDE_MENU_KEY.toUpperCase()],
    action: SHORTCUTS_COPY.sideMenu,
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
          {SHORTCUTS_COPY.title}
        </PageTitle>
        <p className={styles.intro}>
          {SHORTCUTS_COPY.intro} <kbd>{SHORTCUTS_COPY.introKey}</kbd> {SHORTCUTS_COPY.introEnd}
        </p>
      </header>
      <ShortcutList
        title={SHORTCUTS_COPY.whilePlaying}
        rows={shortcutRows({ canShowStats: isDesktop })}
      />
      <ShortcutList title={SHORTCUTS_COPY.aroundRaven} rows={FRAME_ROWS} />
    </section>
  )
}

import type { Library } from '@raven/core'
import { Link } from 'react-router-dom'
import {
  type LibrarySection,
  SECTIONS,
  sectionPath,
  sectionsFor,
} from '@/pages/LibraryPage/librarySections'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const count = new Intl.NumberFormat()

/**
 * The library's tabs its type has, each a link to its own address, the open
 * one marked, with a count beside those the library counts. The header
 * already says the counts aloud, so beside the tabs they are for the eye.
 */
export const LibraryTabs = ({
  library,
  current,
}: {
  library: Library
  current: LibrarySection
}) => (
  <nav aria-label="Sections" className={styles.tabsNav}>
    <ul className={styles.tabs}>
      {sectionsFor(library.settings.kind).map((section) => {
        const n = SECTIONS[section].count(library)
        return (
          <li key={section} className={styles.tabItem}>
            <Link
              to={sectionPath({ libraryId: library.id, section })}
              className={styles.tab}
              aria-current={section === current ? 'page' : undefined}
            >
              {SECTIONS[section].label}
              {n != null && (
                <span className={styles.tabCount} aria-hidden="true">
                  {count.format(n)}
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  </nav>
)

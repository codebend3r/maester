import type { Library } from '@raven/core'
import { Link } from 'react-router-dom'
import {
  type LibrarySection,
  SECTIONS,
  sectionPath,
  sectionsFor,
} from '@/pages/LibraryPage/librarySections'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** The library's tabs its type has, each a link to its own address, the open one marked. */
export const LibraryTabs = ({
  library,
  current,
}: {
  library: Library
  current: LibrarySection
}) => (
  <nav aria-label="Sections">
    <ul className={styles.tabs}>
      {sectionsFor(library.settings.kind).map((section) => (
        <li key={section} className={styles.tabItem}>
          <Link
            to={sectionPath({ libraryId: library.id, section })}
            className={styles.tab}
            aria-current={section === current ? 'page' : undefined}
          >
            {SECTIONS[section].label}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
)

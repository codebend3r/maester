import { useQuery } from '@tanstack/react-query'
import type { Library } from '@raven/core'
import { Icon } from '@raven/ui'
import { Link } from 'react-router-dom'
import { libraryCountsQuery, playlistsQuery } from '@/lib/queries'
import {
  LIBRARY_SECTIONS,
  type LibrarySection,
  SECTIONS,
  type Tallies,
  countText,
  hasSection,
  isListed,
  sectionPath,
  sectionsFor,
} from '@/pages/LibraryPage/librarySections'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

type LibraryTabsProps = {
  library: Library
  current: LibrarySection
}

/**
 * The library's tabs its type has, each a link to its own address, the open
 * one marked, with its icon and the count of what it holds, the account's
 * own counts (and a music library's playlists, the Playlists tab's own
 * list) once they come, and none while they are on their way or failed. A narrow screen shows the icon and count
 * alone, the name still read aloud. The header already says the library's
 * counts aloud, so beside the tabs they are for the eye. The tabs replace
 * the address rather than stack on it, so Back leaves the library.
 */
export const LibraryTabs = ({ library, current }: LibraryTabsProps) => {
  const counts = useQuery(libraryCountsQuery(library.id))
  const playlists = useQuery({
    ...playlistsQuery,
    enabled: hasSection({ kind: library.settings.kind, section: LIBRARY_SECTIONS.playlists }),
  })
  const tallies: Partial<Tallies> = {
    itemCount: library.itemCount,
    unmatchedCount: library.unmatchedCount,
    ...counts.data,
    ...(playlists.data && { playlists: playlists.data.length }),
  }
  return (
    <nav aria-label={LIBRARY_COPY.sections} className={styles.tabsNav}>
      <ul className={styles.tabs}>
        {sectionsFor(library.settings.kind)
          .filter((section) => isListed({ section, tallies }))
          .map((section) => {
            const text = countText({ section, tallies })
            return (
              <li key={section} className={styles.tabItem}>
                <Link
                  to={sectionPath({ libraryId: library.id, section })}
                  replace
                  className={styles.tab}
                  aria-current={section === current ? 'page' : undefined}
                >
                  <Icon name={SECTIONS[section].icon} size="1.15em" />
                  <span className={styles.tabLabel}>{SECTIONS[section].label}</span>
                  {text != null && (
                    <span className={styles.tabCount} aria-hidden="true">
                      {text}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
      </ul>
    </nav>
  )
}

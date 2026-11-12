import { type ReactNode, useId } from 'react'
import { DOWNLOADS_PAGE_COPY } from '@/desktop/DownloadsPage/copy'
import styles from '@/desktop/DownloadsPage/DownloadsShow.module.scss'
import {
  DOWNLOADS_SHOWS,
  type DownloadsShow,
  isDownloadsShow,
  useDownloadsShow,
} from '@/stores/downloadsShow'

const SHOW_LABELS = {
  [DOWNLOADS_SHOWS.everything]: DOWNLOADS_PAGE_COPY.showAll,
  [DOWNLOADS_SHOWS.byLibrary]: DOWNLOADS_PAGE_COPY.showByLibrary,
} as const satisfies Record<DownloadsShow, string>

/** The Show choice, as a muted label before it: one for both of the page's tabs. */
export const ShowBar = () => {
  const id = useId()
  const show = useDownloadsShow((state) => state.show)
  const setShow = useDownloadsShow((state) => state.setShow)
  return (
    <div className={styles.showBar}>
      <label htmlFor={id} className={styles.showLabel}>
        {DOWNLOADS_PAGE_COPY.show}
      </label>
      <select
        id={id}
        className={styles.select}
        value={show}
        onChange={(event) => isDownloadsShow(event.target.value) && setShow(event.target.value)}
      >
        {Object.values(DOWNLOADS_SHOWS).map((value) => (
          <option key={value} value={value}>
            {SHOW_LABELS[value]}
          </option>
        ))}
      </select>
    </div>
  )
}

type LibrarySectionProps = {
  /** The library's name, which heads the section; null for the one run of everything. */
  name: string | null
  children: ReactNode
}

/** A library's downloads under its name, or every download with no heading. */
export const LibrarySection = ({ name, children }: LibrarySectionProps) => {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={name === null ? undefined : headingId}>
      {name !== null && (
        <h2 id={headingId} className={styles.sectionTitle}>
          {name}
        </h2>
      )}
      {children}
    </section>
  )
}

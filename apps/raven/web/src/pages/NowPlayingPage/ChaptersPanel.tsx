import { type Chapter, formatDuration } from '@raven/core'
import { chapterAt, useAudioQueue } from '@raven/ui/headless'
import styles from '@/pages/NowPlayingPage/ChaptersPanel.module.scss'

type ChaptersPanelProps = { chapters: readonly Chapter[] }

/** An audiobook's chapters, the one playing marked; picking one plays from its start. */
export const ChaptersPanel = ({ chapters }: ChaptersPanelProps) => {
  const current = useAudioQueue((store) => chapterAt({ chapters, at: store.position }))
  const seekTo = useAudioQueue((store) => store.seekTo)
  if (chapters.length === 0) {
    return <p className={styles.quiet}>This book names no chapters.</p>
  }
  return (
    <ol className={styles.chapters} aria-label="Chapters">
      {chapters.map((chapter, index) => (
        <li key={chapter.start}>
          <button
            type="button"
            className={index === current ? `${styles.chapter} ${styles.current}` : styles.chapter}
            aria-current={index === current ? 'true' : undefined}
            onClick={() => seekTo(chapter.start)}
          >
            <span className={styles.title}>{chapter.title ?? `Chapter ${index + 1}`}</span>
            <span className={styles.start}>{formatDuration(chapter.start)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

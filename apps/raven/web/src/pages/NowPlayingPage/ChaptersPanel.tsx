import { type Chapter, formatDuration } from '@raven/core'
import { chapterAt, useAudioQueue } from '@raven/ui/headless'
import type { ComponentType } from 'react'
import { NOW_PLAYING_COPY } from '@/pages/NowPlayingPage/copy'
import styles from '@/pages/NowPlayingPage/ChaptersPanel.module.scss'

type ChaptersPanelProps = { chapters: readonly Chapter[] }

/** Whether the book names chapters to list. */
const CHAPTER_VIEW_KEYS = { none: 'none', listed: 'listed' } as const
type ChapterViewKey = (typeof CHAPTER_VIEW_KEYS)[keyof typeof CHAPTER_VIEW_KEYS]

const NoChapters = () => <p className={styles.quiet}>{NOW_PLAYING_COPY.noChapters}</p>

type ChapterListProps = ChaptersPanelProps

const ChapterList = ({ chapters }: ChapterListProps) => {
  const current = useAudioQueue((store) => chapterAt({ chapters, at: store.position }))
  const seekTo = useAudioQueue((store) => store.seekTo)
  return (
    <ol className={styles.chapters} aria-label={NOW_PLAYING_COPY.chapters}>
      {chapters.map((chapter, index) => (
        <li key={chapter.start}>
          <button
            type="button"
            className={index === current ? `${styles.chapter} ${styles.current}` : styles.chapter}
            aria-current={index === current ? 'true' : undefined}
            onClick={() => seekTo(chapter.start)}
          >
            <span className={styles.title}>
              {chapter.title ?? NOW_PLAYING_COPY.chapter(index + 1)}
            </span>
            <span className={styles.start}>{formatDuration(chapter.start)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

const CHAPTER_VIEWS = {
  [CHAPTER_VIEW_KEYS.none]: NoChapters,
  [CHAPTER_VIEW_KEYS.listed]: ChapterList,
} as const satisfies Record<ChapterViewKey, ComponentType<ChaptersPanelProps>>

/** An audiobook's chapters, the one playing marked; picking one plays from its start. */
export const ChaptersPanel = ({ chapters }: ChaptersPanelProps) => {
  const View: ComponentType<ChaptersPanelProps> =
    CHAPTER_VIEWS[chapters.length === 0 ? CHAPTER_VIEW_KEYS.none : CHAPTER_VIEW_KEYS.listed]
  return <View chapters={chapters} />
}

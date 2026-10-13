import { type MediaItem, type UnmatchedShow, unmatchedShowsOf } from '@raven/core'
import { type ReactNode, useId, useRef, useState } from 'react'
import { Button } from '@/components/Button/Button'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { Icon } from '@/components/Icon/Icon'
import { api } from '@/lib/api'
import { plural } from '@/lib/plural'
import styles from '@/components/UnmatchedShows/UnmatchedShows.module.scss'

/** One show folder: a toggle to its episodes, and Fix match, which points the whole folder at a show. */
const UnmatchedShowEntry = ({
  group,
  renderFiles,
}: {
  group: UnmatchedShow
  renderFiles: (files: MediaItem[]) => ReactNode
}) => {
  const regionId = useId()
  const fixButton = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isFixing, setIsFixing] = useState(false)
  const first = group.files[0]

  return (
    <li className={styles.show}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={isOpen}
        aria-controls={regionId}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="up" size={18} />
        </span>
        <span className={styles.title}>{group.title}</span>
        <span className={styles.count}>
          {plural({ n: group.files.length, one: 'episode', many: 'episodes' })}
        </span>
      </button>
      <Button
        ref={fixButton}
        className={styles.fix}
        icon="search"
        aria-label={`Fix match for ${group.title}`}
        onClick={() => setIsFixing(true)}
      >
        Fix match
      </Button>
      <section id={regionId} aria-label={group.title} className={styles.files} hidden={!isOpen}>
        {isOpen && renderFiles(group.files)}
      </section>
      {isFixing && first && (
        <FixMatchDialog
          type="show"
          title={group.title}
          year={null}
          match={(tmdbId) => api.setMatch({ mediaId: first.id, tmdbId })}
          onClose={() => {
            setIsFixing(false)
            fixButton.current?.focus()
          }}
        />
      )}
    </li>
  )
}

/**
 * A TV library's unmatched files, one entry per show folder, each opening
 * in place to its episodes. Fix match on an entry re-points the whole folder.
 */
export const UnmatchedShows = ({
  files,
  renderFiles,
}: {
  files: MediaItem[]
  renderFiles: (files: MediaItem[]) => ReactNode
}) => (
  <ul className={styles.list}>
    {unmatchedShowsOf(files).map((group) => (
      <UnmatchedShowEntry key={group.key} group={group} renderFiles={renderFiles} />
    ))}
  </ul>
)

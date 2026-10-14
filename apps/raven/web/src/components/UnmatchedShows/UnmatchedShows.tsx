import {
  type AiSuggestion,
  type MediaItem,
  type UnmatchedShow,
  unmatchedShowsOf,
} from '@raven/core'
import { type ReactNode, useId, useRef, useState } from 'react'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { AiSuggestionCard } from '@/components/AiSuggestionCard/AiSuggestionCard'
import { Button } from '@/components/Button/Button'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { Icon } from '@/components/Icon/Icon'
import { api } from '@/lib/api'
import { plural } from '@/lib/plural'
import { useReturnFocus } from '@/lib/useReturnFocus'
import styles from '@/components/UnmatchedShows/UnmatchedShows.module.scss'

/**
 * One show folder: a toggle to its episodes, and Fix match, which points the
 * whole folder at a show, with the admin lock off. When the AI lookup
 * suggested a show, its card holds Accept and the folder's Fix match.
 */
const UnmatchedShowEntry = ({
  group,
  renderFiles,
  suggestionOf,
}: {
  group: UnmatchedShow
  renderFiles: (files: MediaItem[]) => ReactNode
  suggestionOf: (file: MediaItem) => AiSuggestion | null
}) => {
  const regionId = useId()
  const fixButton = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isFixing, setIsFixing] = useState(false)
  const first = group.files[0]
  // A file still pending has no suggestion yet, so the card follows the first that has one.
  const suggested = group.files
    .flatMap((file) => {
      const suggestion = suggestionOf(file)
      return suggestion == null ? [] : [{ file, suggestion }]
    })
    .at(0)
  useReturnFocus({ isOpen: isFixing, target: fixButton })

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
          <Icon name="next" size={18} />
        </span>
        <span className={styles.title}>{group.title}</span>
        <span className={styles.count}>
          {plural({ n: group.files.length, one: 'episode', many: 'episodes' })}
        </span>
      </button>
      <AdminOnly>
        {!suggested && (
          <Button
            ref={fixButton}
            className={styles.fix}
            icon="search"
            aria-label={`Fix match for ${group.title}`}
            onClick={() => setIsFixing(true)}
          >
            Fix match
          </Button>
        )}
      </AdminOnly>
      {suggested && (
        <div className={styles.suggestion}>
          <AiSuggestionCard
            suggestion={suggested.suggestion}
            subject={group.title}
            accept={(tmdbId) => api.setMatch({ mediaId: suggested.file.id, tmdbId })}
            onFix={() => setIsFixing(true)}
            fixRef={fixButton}
          />
        </div>
      )}
      <section id={regionId} aria-label={group.title} className={styles.files} hidden={!isOpen}>
        {isOpen && renderFiles(group.files)}
      </section>
      {isFixing && first && (
        <FixMatchDialog
          type="show"
          title={group.title}
          year={null}
          libraryId={first.libraryId}
          subject={{ kind: 'media', id: first.id }}
          match={(tmdbId) => api.setMatch({ mediaId: first.id, tmdbId })}
          onClose={() => setIsFixing(false)}
        />
      )}
    </li>
  )
}

/** A listing the AI lookup has nothing for. */
const NO_SUGGESTION = (): AiSuggestion | null => null

/**
 * A TV library's unmatched files, one entry per show folder, each opening
 * in place to its episodes. Fix match on an entry re-points the whole
 * folder; a suggestion's Accept does the same with the show it names.
 */
export const UnmatchedShows = ({
  files,
  renderFiles,
  suggestionOf = NO_SUGGESTION,
}: {
  files: MediaItem[]
  renderFiles: (files: MediaItem[]) => ReactNode
  /** What the AI lookup suggests for a file's show folder; none unless given. */
  suggestionOf?: (file: MediaItem) => AiSuggestion | null
}) => (
  <ul className={styles.list}>
    {unmatchedShowsOf(files).map((group) => (
      <UnmatchedShowEntry
        key={group.key}
        group={group}
        renderFiles={renderFiles}
        suggestionOf={suggestionOf}
      />
    ))}
  </ul>
)

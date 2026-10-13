import type { AiSuggestion, MediaItem, UnmatchedFile } from '@raven/core'
import { useId, useRef, useState } from 'react'
import { AiSuggestionCard } from '@/components/AiSuggestionCard/AiSuggestionCard'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { api } from '@/lib/api'
import { useReturnFocus } from '@/lib/useReturnFocus'
import styles from '@/components/SuggestedMovies/SuggestedMovies.module.scss'

/** One card: a file with a suggestion, standing for every file of its folder suggested the same. */
export type SuggestedMovie = { key: string; file: MediaItem; suggestion: AiSuggestion }

/**
 * The files the AI lookup suggested a movie for, one per folder and
 * suggestion, as a movie kept in two qualities is one; a file at the root of
 * the library is its own. A folder holding several movies keeps them apart by
 * title and year, as the lookup groups them.
 */
export const suggestedMoviesOf = (files: readonly UnmatchedFile[]): SuggestedMovie[] =>
  files.reduce<SuggestedMovie[]>((found, file) => {
    const { aiSuggestion } = file
    if (aiSuggestion == null) return found
    const key =
      file.folder === ''
        ? `file:${file.id}`
        : `folder:${file.folder}|${file.title}|${file.year}|${aiSuggestion.tmdbId}`
    return found.some((entry) => entry.key === key)
      ? found
      : found.concat({ key, file, suggestion: aiSuggestion })
  }, [])

/** One suggestion: its card, labelled by the folder or the loose file it is for, and Fix match on that file. */
const SuggestedMovieEntry = ({
  entry,
  libraryId,
}: {
  entry: SuggestedMovie
  libraryId: number
}) => {
  const fixButton = useRef<HTMLButtonElement>(null)
  const [isFixing, setIsFixing] = useState(false)
  useReturnFocus({ isOpen: isFixing, target: fixButton })
  const { file } = entry
  const subject = file.folder === '' ? file.fileName : file.folder
  const pointAt = (tmdbId: string | null) => api.setMatch({ mediaId: file.id, tmdbId })
  return (
    <li className={styles.entry}>
      <p className={styles.file}>{subject}</p>
      <AiSuggestionCard
        suggestion={entry.suggestion}
        subject={subject}
        accept={pointAt}
        onFix={() => setIsFixing(true)}
        fixRef={fixButton}
      />
      {isFixing && (
        <FixMatchDialog
          type="movie"
          title={file.title}
          year={file.year}
          fileName={file.fileName}
          libraryId={libraryId}
          match={pointAt}
          onClose={() => setIsFixing(false)}
        />
      )}
    </li>
  )
}

/**
 * The AI lookup's suggestions in a movie library's Not matched tab, above
 * its files; nothing when it has none.
 */
export const SuggestedMovies = ({
  files,
  libraryId,
}: {
  files: readonly UnmatchedFile[]
  libraryId: number
}) => {
  const headingId = useId()
  const suggested = suggestedMoviesOf(files)
  if (suggested.length === 0) return null
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Suggested by AI
      </h2>
      <ul className={styles.list}>
        {suggested.map((entry) => (
          <SuggestedMovieEntry key={entry.key} entry={entry} libraryId={libraryId} />
        ))}
      </ul>
    </section>
  )
}

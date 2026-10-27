import {
  type AiSuggestion,
  type MediaItem,
  type UnmatchedFile,
  plural,
  MATCH_SUBJECT_KINDS,
  ITEM_TYPES,
} from '@raven/core'
import { useId, useRef, useState } from 'react'
import { AiSuggestionCard } from '@/components/AiSuggestionCard/AiSuggestionCard'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { api } from '@/lib/api'
import { useReturnFocus } from '@/lib/useReturnFocus'
import styles from '@/components/SuggestedMovies/SuggestedMovies.module.scss'

/**
 * One card: the first file of a group the AI lookup suggested a movie for,
 * labelled by the group's place: the folder's name for a folder holding one
 * movie, else the file's own name.
 */
export type SuggestedMovie = { file: MediaItem; label: string; suggestion: AiSuggestion }

type LabelOfProps = { file: MediaItem; place: string }

/** What a card is labelled by: its folder's name when its place is the file's folder, else the file. */
const labelOf = ({ file, place }: LabelOfProps): string =>
  place === file.folder ? (place.split('/').at(-1) ?? place) : file.fileName

/**
 * The files the AI lookup suggested a movie for, one per place it was asked
 * about, as the server keys them: a folder holding one movie is one, so a
 * movie kept in two qualities is one card; a folder of several movies, or a
 * file at the root of the library, gives each file its own.
 */
export const suggestedMoviesOf = (files: readonly UnmatchedFile[]): SuggestedMovie[] =>
  files.reduce<SuggestedMovie[]>((found, file) => {
    const { aiSuggestion } = file
    if (aiSuggestion == null) return found
    return found.some((entry) => entry.suggestion.place === aiSuggestion.place)
      ? found
      : found.concat({
          file,
          label: labelOf({ file, place: aiSuggestion.place }),
          suggestion: aiSuggestion,
        })
  }, [])

type SuggestedMovieEntryProps = {
  entry: SuggestedMovie
  libraryId: number
}

/** One suggestion: its card, labelled by the folder or the file it is for, and Fix match on that file. */
const SuggestedMovieEntry = ({ entry, libraryId }: SuggestedMovieEntryProps) => {
  const fixButton = useRef<HTMLButtonElement>(null)
  const [isFixing, setIsFixing] = useState(false)
  useReturnFocus({ isOpen: isFixing, target: fixButton })
  const { file, label } = entry
  const pointAt = (tmdbId: string | null) => api.setMatch({ mediaId: file.id, tmdbId })
  return (
    <li className={styles.entry}>
      <p className={styles.file}>{label}</p>
      <AiSuggestionCard
        suggestion={entry.suggestion}
        subject={label}
        accept={pointAt}
        onFix={() => setIsFixing(true)}
        fixRef={fixButton}
      />
      {isFixing && (
        <FixMatchDialog
          type={ITEM_TYPES.movie}
          title={file.title}
          year={file.year}
          fileName={file.fileName}
          libraryId={libraryId}
          subject={{ kind: MATCH_SUBJECT_KINDS.media, id: file.id }}
          match={pointAt}
          onClose={() => setIsFixing(false)}
        />
      )}
    </li>
  )
}

type SuggestedMoviesProps = {
  files: readonly UnmatchedFile[]
  libraryId: number
}

/**
 * The AI lookup's suggestions in a movie library's Not matched tab, under a
 * ruled heading counting them, above its files; nothing when it has none.
 */
export const SuggestedMovies = ({ files, libraryId }: SuggestedMoviesProps) => {
  const headingId = useId()
  const suggested = suggestedMoviesOf(files)
  if (suggested.length === 0) return null
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        aside={plural({ n: suggested.length, one: 'suggestion', many: 'suggestions' })}
      >
        Suggested by AI
      </SectionHeading>
      <ul className={styles.list}>
        {suggested.map((entry) => (
          <SuggestedMovieEntry key={entry.suggestion.place} entry={entry} libraryId={libraryId} />
        ))}
      </ul>
    </section>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AiMatch,
  CONFIDENCE_TIERS,
  type MatchCandidate,
  type MatchItemType,
  type MatchSubject,
  confidenceTierOf,
} from '@raven/core'
import { type ComponentType, type FormEvent, useId } from 'react'
import { AiMatchNote } from '@/components/AiMatchNote/AiMatchNote'
import { MatchTier } from '@/components/MatchTier/MatchTier'
import { Button, Icon } from '@raven/ui'
import { SearchField } from '@/components/SearchField/SearchField'
import { api } from '@/lib/api'
import { afterMatch, useSearch } from '@raven/ui/headless'
import { matchSearchQuery } from '@/lib/queries'
import { useModal } from '@/lib/useModal'
import { FIX_MATCH_DIALOG_COPY } from '@/components/FixMatchDialog/copy'
import styles from '@/components/FixMatchDialog/FixMatchDialog.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const NOT_A = FIX_MATCH_DIALOG_COPY.notA satisfies Record<MatchItemType, string>

const POSTER_KINDS = { image: 'image', initial: 'initial' } as const
type PosterKind = (typeof POSTER_KINDS)[keyof typeof POSTER_KINDS]

type CandidatePosterProps = { poster: string | null; title: string }

type PosterImageProps = CandidatePosterProps

const PosterImage = ({ poster }: PosterImageProps) => (
  <img src={poster ?? ''} alt="" loading="lazy" decoding="async" />
)

type PosterInitialProps = CandidatePosterProps

const PosterInitial = ({ title }: PosterInitialProps) => (
  <span className={styles.initial} aria-hidden="true">
    {title.slice(0, 1)}
  </span>
)

const CANDIDATE_POSTERS = {
  [POSTER_KINDS.image]: PosterImage,
  [POSTER_KINDS.initial]: PosterInitial,
} as const satisfies Record<PosterKind, ComponentType<CandidatePosterProps>>

const yearFrom = (text: string): number | null => {
  const year = Number.parseInt(text.trim(), 10)
  return Number.isInteger(year) && year > 1800 && year < 2200 ? year : null
}

type CandidateProps = {
  candidate: MatchCandidate
  /** The first result, when it is Strong: named the best match. */
  isBest: boolean
  disabled: boolean
  onChoose: () => void
}

const Candidate = ({ candidate, isBest, disabled, onChoose }: CandidateProps) => {
  const tierId = useId()
  const poster = api.candidatePosterUrl(candidate.poster)
  const name =
    candidate.year == null
      ? candidate.title
      : FIX_MATCH_DIALOG_COPY.named({ title: candidate.title, year: candidate.year })
  const CandidatePoster = CANDIDATE_POSTERS[poster ? POSTER_KINDS.image : POSTER_KINDS.initial]
  const tier = confidenceTierOf(candidate.confidence)
  return (
    <li className={isBest ? `${styles.candidate} ${styles.best}` : styles.candidate}>
      <span className={styles.poster}>
        <CandidatePoster poster={poster} title={candidate.title} />
        <span className={`${styles.stamp} ${styles[tier]}`} aria-hidden="true">
          {tier === CONFIDENCE_TIERS.strong && <Icon name="check" size={12} />}
          {candidate.confidence}
        </span>
      </span>
      <span className={styles.details}>
        <span className={styles.name}>{candidate.title}</span>
        {candidate.year != null && <span className={styles.year}>{candidate.year}</span>}
        <MatchTier id={tierId} confidence={candidate.confidence} isBest={isBest} />
        {candidate.overview != null && (
          <span className={styles.overview}>{candidate.overview}</span>
        )}
      </span>
      <Button
        className={styles.choose}
        disabled={disabled}
        onClick={onChoose}
        aria-label={FIX_MATCH_DIALOG_COPY.chooseLabel(name)}
        aria-describedby={tierId}
      >
        {FIX_MATCH_DIALOG_COPY.choose}
      </Button>
    </li>
  )
}

type FixMatchDialogProps<T> = {
  /** What the dialog searches for: a movie, or a show. */
  type: MatchItemType
  /** What the search box starts with: the parsed title. */
  title: string
  year: number | null
  /** Named under the heading, so the viewer knows which file this is for. */
  fileName?: string
  /** Why the AI lookup matched what is being fixed, being sure; null or left out when it did not. */
  aiMatch?: AiMatch | null
  /** The library the file is in: the results its type prefers are listed first. */
  libraryId?: number
  /** The file (and its show folder) or the show being fixed: the results are scored against what it has on disk. */
  subject: MatchSubject
  /** Points the file or show at `tmdbId`, or at nothing for null. */
  match: (tmdbId: string | null) => Promise<T>
  /** Whether "Not a movie" (or show) is offered. */
  allowNone?: boolean
  onClose: () => void
  onMatched?: (result: T) => void
}

/**
 * Fix match: searches TMDB with the title and year a name gave, and again
 * as the viewer edits them, scored against what the subject has on disk
 * and listed best first, and points a
 * file (or a whole show) at the result the viewer chooses, or at nothing.
 * `match` does the pointing; whatever is chosen is kept by folder, so
 * renames and re-downloads keep it. Not a movie and Cancel sit in a footer
 * that stays in view as the results scroll.
 */
export const FixMatchDialog = <T,>({
  type,
  title,
  year,
  fileName,
  aiMatch = null,
  libraryId,
  subject,
  match,
  allowNone = true,
  onClose,
  onMatched,
}: FixMatchDialogProps<T>) => {
  const { dialog } = useModal()
  const ids = { title: useId(), note: useId(), query: useId(), year: useId(), results: useId() }
  const queryClient = useQueryClient()
  // The year is half the search, so it settles as the title does.
  const typed = {
    title: useSearch({ initial: title }),
    year: useSearch({ initial: year == null ? '' : String(year) }),
  }
  const asked = { query: typed.title.query, year: yearFrom(typed.year.query) }

  const results = useQuery(
    matchSearchQuery({
      type,
      query: asked.query,
      year: asked.year,
      libraryId: libraryId ?? null,
      subject,
    }),
  )

  const choose = useMutation({
    mutationFn: match,
    onSuccess: async (result) => {
      await afterMatch(queryClient)
      onMatched?.(result)
      onClose()
    },
  })

  const search = (event: FormEvent) => {
    event.preventDefault()
    typed.title.searchNow()
    typed.year.searchNow()
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={ids.title}
      aria-describedby={aiMatch ? ids.note : undefined}
      onClose={onClose}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 id={ids.title} className={styles.title}>
            {COMMON_COPY.fixMatch}
          </h2>
          {fileName && <p className={styles.file}>{fileName}</p>}
          {aiMatch && <AiMatchNote aiMatch={aiMatch} id={ids.note} />}
        </header>

        <search>
          <form className={styles.form} onSubmit={search}>
            <div className={`${styles.field} ${styles.titleField}`}>
              <label htmlFor={ids.query}>{COMMON_COPY.title}</label>
              <SearchField id={ids.query} search={typed.title} autoComplete="off" />
            </div>
            <div className={`${styles.field} ${styles.yearField}`}>
              <label htmlFor={ids.year}>{COMMON_COPY.year}</label>
              <input
                id={ids.year}
                inputMode="numeric"
                value={typed.year.text}
                onChange={(event) => typed.year.setText(event.target.value)}
                autoComplete="off"
              />
            </div>
            <Button type="submit" icon="search" className={styles.submit}>
              {FIX_MATCH_DIALOG_COPY.search}
            </Button>
          </form>
        </search>

        {(choose.isError || results.isError) && (
          <p role="alert" className={styles.error}>
            <Icon name="alert" size={16} />
            {(choose.error ?? results.error)?.message ?? FIX_MATCH_DIALOG_COPY.failed}
          </p>
        )}

        <section
          aria-labelledby={ids.results}
          aria-busy={results.isFetching}
          className={styles.results}
        >
          <h3 id={ids.results} className="visually-hidden">
            {FIX_MATCH_DIALOG_COPY.results}
          </h3>
          {results.isSuccess && results.data.length === 0 && (
            <p className={styles.hint}>{FIX_MATCH_DIALOG_COPY.noResults}</p>
          )}
          {results.isFetching && !results.data && (
            <p className={styles.hint}>{FIX_MATCH_DIALOG_COPY.searching}</p>
          )}
          {!!results.data?.length && (
            <ul className={styles.list}>
              {results.data.map((candidate, index) => (
                <Candidate
                  key={candidate.tmdbId}
                  candidate={candidate}
                  isBest={
                    index === 0 &&
                    confidenceTierOf(candidate.confidence) === CONFIDENCE_TIERS.strong
                  }
                  disabled={choose.isPending}
                  onChoose={() => choose.mutate(candidate.tmdbId)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className={styles.actions}>
        {allowNone && (
          <Button
            className={styles.none}
            disabled={choose.isPending}
            onClick={() => choose.mutate(null)}
          >
            {NOT_A[type]}
          </Button>
        )}
        <Button className={styles.cancel} onClick={onClose}>
          {COMMON_COPY.cancel}
        </Button>
      </footer>
    </dialog>
  )
}

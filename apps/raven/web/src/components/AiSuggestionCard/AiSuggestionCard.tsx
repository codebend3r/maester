import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AiSuggestion } from '@raven/core'
import { type Ref, useId } from 'react'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, Icon } from '@raven/ui'
import { api } from '@/lib/api'
import { afterMatch } from '@raven/ui/headless'
import styles from '@/components/AiSuggestionCard/AiSuggestionCard.module.scss'

/** A suggestion's title as a person reads it, with its year when TMDB gives one. */
const suggestedName = (suggestion: AiSuggestion): string =>
  suggestion.year == null ? suggestion.title : `${suggestion.title} (${suggestion.year})`

type AiSuggestionCardProps = {
  suggestion: AiSuggestion
  /** What the suggestion is for, named in the buttons' labels: the show folder, or the file. */
  subject: string
  /** Points the files at `tmdbId`, as Fix match does. */
  accept: (tmdbId: string) => Promise<unknown>
  onFix: () => void
  /** The Fix match button, for focus to come back to once its dialog closes. */
  fixRef?: Ref<HTMLButtonElement>
}

/**
 * What the AI lookup suggests for files it was not sure of: the poster, the
 * title and year, and the reason it gave. Accept points the files at it with
 * the call Fix match makes, so it is kept as a Fix match; Fix match opens
 * the search to choose another, with Accept at the end as the primary
 * action. Both wait for the admin lock to be off.
 */
export const AiSuggestionCard = ({
  suggestion,
  subject,
  accept,
  onFix,
  fixRef,
}: AiSuggestionCardProps) => {
  const titleId = useId()
  const queryClient = useQueryClient()
  const accepting = useMutation({
    mutationFn: () => accept(suggestion.tmdbId),
    onSuccess: () => afterMatch(queryClient),
  })
  const poster = api.candidatePosterUrl(suggestion.poster)
  const name = suggestedName(suggestion)
  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <span className={styles.poster}>
        {poster ? (
          <img src={poster} alt="" loading="lazy" decoding="async" />
        ) : (
          <span aria-hidden="true">{suggestion.title.slice(0, 1)}</span>
        )}
      </span>
      <div className={styles.text}>
        <p id={titleId} className={styles.title}>
          Suggested: {name}
        </p>
        <p className={styles.reason}>{suggestion.reason}</p>
        {accepting.isError && (
          <p role="alert" className={styles.error}>
            <Icon name="alert" size={16} />
            {accepting.error.message}
          </p>
        )}
      </div>
      <AdminOnly>
        <footer className={styles.actions}>
          <Button
            ref={fixRef}
            icon="search"
            aria-label={`Fix match for ${subject}`}
            onClick={onFix}
          >
            Fix match
          </Button>
          <Button
            tone="primary"
            disabled={accepting.isPending}
            aria-label={`Accept ${name} for ${subject}`}
            onClick={() => accepting.mutate()}
          >
            Accept
          </Button>
        </footer>
      </AdminOnly>
    </article>
  )
}

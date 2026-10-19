import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  type Duplicate,
  type DuplicateCard,
  type Duplicates as DuplicatesListing,
  type Library,
  type PosterEntry,
  type SplitHow,
  canSplitByCut,
  cardLink,
  cardTitle,
  inLibrary,
  plural,
  versionFacts,
} from '@raven/core'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button } from '@raven/ui'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { api } from '@/lib/api'
import { afterSplit } from '@/lib/invalidate'
import { POSTER_SIZES } from '@/lib/posters'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/components/Duplicates/Duplicates.module.scss'

/** The card's poster, opening its page. */
const Poster = ({ entry }: { entry: PosterEntry }) => (
  <Link
    {...cardLink({ media: entry.media, hasPages: true })}
    className={styles.poster}
    tabIndex={-1}
    aria-hidden="true"
  >
    <PosterImage media={entry.media} poster={entry.poster} sizes={POSTER_SIZES.duplicate} />
  </Link>
)

/** A card's files, best first, each with the cut its name reads as. */
const Files = ({ card }: { card: DuplicateCard }) => (
  <ul className={styles.files} aria-label="Files">
    {card.files.map(({ media, cut }) => {
      const facts = [cut?.label ?? 'Standard', ...versionFacts(media)]
      return (
        <li key={media.id} className={styles.file}>
          <span className={styles.facts}>
            {facts.map((fact, index) => (
              <span
                key={`${index}:${fact}`}
                className={index === 0 && cut != null ? styles.cut : undefined}
              >
                {fact}
              </span>
            ))}
          </span>
          <span className={styles.fileName}>{media.fileName}</span>
        </li>
      )
    })}
  </ul>
)

/** The two ways to split a card of several files, and a word on whether Smart split apart can tell its files apart. */
const Splits = ({
  card,
  busy,
  onSplit,
}: {
  card: DuplicateCard
  busy: boolean
  onSplit: (how: SplitHow) => void
}) => {
  const canTellApart = canSplitByCut(card.files)
  return (
    <>
      <div className={styles.actions}>
        <Button icon="split" disabled={busy} onClick={() => onSplit('apart')}>
          Split apart
        </Button>
        <Button icon="wand" disabled={busy || !canTellApart} onClick={() => onSplit('smart')}>
          Smart split apart
        </Button>
      </div>
      <p className={styles.hint}>
        {canTellApart
          ? 'Smart split apart gives each cut its own card and keeps copies of one cut together.'
          : 'Every file reads as the same cut, so Smart split apart has nothing to tell apart.'}
      </p>
    </>
  )
}

/**
 * A movie with more than one file: its poster and title, then its cards.
 * While its files share one card, that card's files and the ways to split
 * it; once split, each card under its own title, any that still holds
 * several files splittable again, and Put back together for them all.
 * Splitting and putting back wait for the admin lock to be off.
 */
const MovieDuplicate = ({
  movie,
  busy,
  onSplit,
  onJoin,
}: {
  movie: Duplicate
  busy: boolean
  onSplit: (split: { mediaId: number; how: SplitHow }) => void
  onJoin: () => void
}) => {
  const headingId = useId()
  const [own] = movie.cards
  if (!own) return null
  const item = own.entry.media.item
  const files = movie.cards.reduce((sum, card) => sum + card.files.length, 0)
  const isSplit = movie.cards.length > 1
  const year = item?.year ?? own.entry.media.year
  const meta = [
    year == null ? null : String(year),
    plural({ n: files, one: 'file', many: 'files' }),
    isSplit ? plural({ n: movie.cards.length, one: 'card', many: 'cards' }) : null,
  ].filter((part): part is string => part != null)

  return (
    <li>
      <article className={styles.movie} aria-labelledby={headingId}>
        <Poster entry={own.entry} />
        <header className={styles.header}>
          <h3 id={headingId} className={styles.title}>
            <Link
              to={inLibrary({
                page: `/movies/${movie.itemId}`,
                libraryId: own.entry.media.libraryId,
              })}
            >
              {item?.title ?? own.entry.media.title}
            </Link>
          </h3>
          <p className={styles.meta}>{meta.join(' · ')}</p>
        </header>
        {isSplit ? (
          <ul className={styles.cards} aria-label="Cards">
            {movie.cards.map((card) => (
              <li key={card.entry.media.id} className={styles.card}>
                <h4 className={styles.cardTitle}>
                  <Link {...cardLink({ media: card.entry.media, hasPages: true })}>
                    {cardTitle(card.entry.media).title}
                  </Link>
                </h4>
                <Files card={card} />
                <AdminOnly>
                  {card.files.length > 1 && (
                    <Splits
                      card={card}
                      busy={busy}
                      onSplit={(how) => onSplit({ mediaId: card.entry.media.id, how })}
                    />
                  )}
                </AdminOnly>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.cards}>
            <Files card={own} />
            <AdminOnly>
              <Splits
                card={own}
                busy={busy}
                onSplit={(how) => onSplit({ mediaId: own.entry.media.id, how })}
              />
            </AdminOnly>
          </div>
        )}
        <AdminOnly>
          {isSplit && (
            <footer className={styles.join}>
              <Button icon="merge" disabled={busy} onClick={onJoin}>
                Put back together
              </Button>
              <p className={styles.hint}>Its files go back on one card.</p>
            </footer>
          )}
        </AdminOnly>
      </article>
    </li>
  )
}

/**
 * A movie library's Duplicates: each movie with more than one file, its
 * cards and the files on them. Split apart gives every file of a card a
 * card of its own; Smart split apart gives each cut its own and keeps
 * copies of one cut together. A split movie stays, its cards listed, with
 * Put back together.
 */
export const Duplicates = ({
  library,
  listing,
}: {
  library: Library
  listing: DuplicatesListing
}) => {
  const queryClient = useQueryClient()
  const settle = (updated: DuplicatesListing) => {
    queryClient.setQueryData(queryKeys.duplicates(library.id), updated)
    return afterSplit({ queryClient, libraryId: library.id })
  }
  const split = useMutation({
    mutationFn: ({ mediaId, how }: { mediaId: number; how: SplitHow }) =>
      api.splitDuplicate({ libraryId: library.id, mediaId, how }),
    onSuccess: settle,
  })
  const join = useMutation({
    mutationFn: (itemId: number) => api.joinSplit({ libraryId: library.id, itemId }),
    onSuccess: settle,
  })
  const busy = split.isPending || join.isPending
  const failure = split.error ?? join.error

  return (
    <div className={styles.duplicates}>
      {failure && (
        <p className={styles.error} role="alert">
          {failure.message}
        </p>
      )}
      <ul className={styles.list} aria-label="Movies with more than one file">
        {listing.map((movie) => (
          <MovieDuplicate
            key={movie.itemId}
            movie={movie}
            busy={busy}
            onSplit={(request) => split.mutate(request)}
            onJoin={() => join.mutate(movie.itemId)}
          />
        ))}
      </ul>
    </div>
  )
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  type Duplicate,
  type DuplicateCard,
  type DuplicateFile,
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
import { type ComponentType, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { ConfirmDelete } from '@/components/ConfirmDelete/ConfirmDelete'
import { Button } from '@raven/ui'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { api } from '@/lib/api'
import { afterSplit, queryKeys } from '@raven/ui/headless'
import { POSTER_SIZES } from '@/lib/posters'
import { WordFact } from '@/components/ResolutionChip/ResolutionChip'
import { DUPLICATES_COPY } from '@/components/Duplicates/copy'
import styles from '@/components/Duplicates/Duplicates.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type PosterProps = { entry: PosterEntry }

/** The card's poster, opening its page. */
const Poster = ({ entry }: PosterProps) => (
  <Link
    {...cardLink({ media: entry.media, hasPages: true })}
    className={styles.poster}
    tabIndex={-1}
    aria-hidden="true"
  >
    <PosterImage media={entry.media} poster={entry.poster} sizes={POSTER_SIZES.duplicate} />
  </Link>
)

type FileRowProps = { file: DuplicateFile }

/** One file: the cut its name reads as, its facts and name, and, with the admin lock off, Delete. */
const FileRow = ({ file: { media, cut } }: FileRowProps) => {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className={styles.file}>
      <span className={styles.facts}>
        <span className={cut == null ? undefined : styles.cut}>
          {cut?.label ?? DUPLICATES_COPY.standardCut}
        </span>
        {versionFacts(media).map((fact) => (
          <span key={fact}>
            <WordFact fact={fact} />
          </span>
        ))}
      </span>
      <span className={styles.fileName}>{media.fileName}</span>
      <AdminOnly>
        <Button
          icon="trash"
          className={styles.remove}
          aria-label={DUPLICATES_COPY.deleteFile(media.fileName)}
          onClick={() => setConfirming(true)}
        />
        {confirming && <ConfirmDelete media={media} onClose={() => setConfirming(false)} />}
      </AdminOnly>
    </li>
  )
}

type FilesProps = { card: DuplicateCard }

/** A card's files, best first. */
const Files = ({ card }: FilesProps) => (
  <ul className={styles.files} aria-label={DUPLICATES_COPY.files}>
    {card.files.map((file) => (
      <FileRow key={file.media.id} file={file} />
    ))}
  </ul>
)

type SplitsProps = {
  card: DuplicateCard
  busy: boolean
  onSplit: (how: SplitHow) => void
}

/** The two ways to split a card of several files, and a word on whether Smart split apart can tell its files apart. */
const Splits = ({ card, busy, onSplit }: SplitsProps) => {
  const canTellApart = canSplitByCut(card.files)
  return (
    <>
      <div className={styles.actions}>
        <Button icon="split" disabled={busy} onClick={() => onSplit('apart')}>
          {DUPLICATES_COPY.splitApart}
        </Button>
        <Button icon="wand" disabled={busy || !canTellApart} onClick={() => onSplit('smart')}>
          {DUPLICATES_COPY.smartSplit}
        </Button>
      </div>
      <p className={styles.hint}>
        {canTellApart ? DUPLICATES_COPY.smartSplitHint : DUPLICATES_COPY.sameCutHint}
      </p>
    </>
  )
}

type OnSplitProps = { mediaId: number; how: SplitHow }

type MovieDuplicateProps = {
  movie: Duplicate
  /** The movie's first card: its own while it is not split. */
  own: DuplicateCard
  busy: boolean
  onSplit: (split: OnSplitProps) => void
  onJoin: () => void
}

/** A movie's cards once split, or the one card its files share. */
const CARD_LAYOUTS = { split: 'split', shared: 'shared' } as const

type CardLayout = (typeof CARD_LAYOUTS)[keyof typeof CARD_LAYOUTS]

type CardsProps = Omit<MovieDuplicateProps, 'onJoin'>

type SplitCardsProps = CardsProps

/** Each card under its own title, any that still holds several files splittable again. */
const SplitCards = ({ movie, busy, onSplit }: SplitCardsProps) => (
  <ul className={styles.cards} aria-label={DUPLICATES_COPY.cards}>
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
)

type SharedCardProps = CardsProps

/** The one card's files, and the ways to split it. */
const SharedCard = ({ own, busy, onSplit }: SharedCardProps) => (
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
)

const CARD_VIEWS = {
  [CARD_LAYOUTS.split]: SplitCards,
  [CARD_LAYOUTS.shared]: SharedCard,
} as const satisfies Record<CardLayout, ComponentType<CardsProps>>

/**
 * A movie with more than one file: its poster and title, then its cards.
 * While its files share one card, that card's files and the ways to split
 * it; once split, each card under its own title, any that still holds
 * several files splittable again, and Put back together for them all.
 * Splitting, putting back and deleting a file wait for the admin lock to be off.
 */
const MovieDuplicate = ({ movie, own, busy, onSplit, onJoin }: MovieDuplicateProps) => {
  const headingId = useId()
  const item = own.entry.media.item
  const files = movie.cards.reduce((sum, card) => sum + card.files.length, 0)
  const isSplit = movie.cards.length > 1
  const year = item?.year ?? own.entry.media.year
  const meta = [
    year == null ? null : String(year),
    plural({ n: files, ...DUPLICATES_COPY.fileWords }),
    isSplit ? plural({ n: movie.cards.length, ...DUPLICATES_COPY.cardWords }) : null,
  ].filter((part): part is string => part != null)
  const Cards = CARD_VIEWS[isSplit ? CARD_LAYOUTS.split : CARD_LAYOUTS.shared]

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
          <p className={styles.meta}>{meta.join(COMMON_COPY.separator)}</p>
        </header>
        <Cards movie={movie} own={own} busy={busy} onSplit={onSplit} />
        <AdminOnly>
          {isSplit && (
            <footer className={styles.join}>
              <Button icon="merge" disabled={busy} onClick={onJoin}>
                {DUPLICATES_COPY.putBack}
              </Button>
              <p className={styles.hint}>{DUPLICATES_COPY.putBackHint}</p>
            </footer>
          )}
        </AdminOnly>
      </article>
    </li>
  )
}

type DuplicatesProps = {
  library: Library
  listing: DuplicatesListing
}

/**
 * A movie library's Duplicates: each movie with more than one file, its
 * cards and the files on them. Split apart gives every file of a card a
 * card of its own; Smart split apart gives each cut its own and keeps
 * copies of one cut together. A split movie stays, its cards listed, with
 * Put back together.
 */
export const Duplicates = ({ library, listing }: DuplicatesProps) => {
  const queryClient = useQueryClient()
  const settle = (updated: DuplicatesListing) => {
    queryClient.setQueryData(queryKeys.duplicates(library.id), updated)
    return afterSplit({ queryClient, libraryId: library.id })
  }
  type SplitMutationFnProps = { mediaId: number; how: SplitHow }

  const split = useMutation({
    mutationFn: ({ mediaId, how }: SplitMutationFnProps) =>
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
      <ul className={styles.list} aria-label={DUPLICATES_COPY.movies}>
        {listing.map((movie) => {
          const [own] = movie.cards
          return (
            own && (
              <MovieDuplicate
                key={movie.itemId}
                movie={movie}
                own={own}
                busy={busy}
                onSplit={(request) => split.mutate(request)}
                onJoin={() => join.mutate(movie.itemId)}
              />
            )
          )
        })}
      </ul>
    </div>
  )
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type MediaItem, plural } from '@raven/core'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@raven/ui'
import { api } from '@/lib/api'
import { afterSplit } from '@/lib/invalidate'
import { cardLink } from '@/lib/itemLinks'
import styles from '@/components/MovieFiles/MovieFiles.module.scss'

/** The movie's other cards in the library, each with its files, best first. */
const otherCards = ({
  files,
  everyCard,
}: {
  files: readonly MediaItem[]
  everyCard: readonly MediaItem[]
}): MediaItem[][] => {
  const shown = new Set(files.map((file) => file.id))
  const cards = everyCard
    .filter((file) => !shown.has(file.id))
    .reduce(
      (gathered, file) => gathered.set(file.card, [...(gathered.get(file.card) ?? []), file]),
      new Map<string | null, MediaItem[]>(),
    )
  return [...cards.values()]
}

/**
 * Edit metadata's files: the names of the files on the card the page is
 * for, best first, counted once there are two or more. Split apart gives
 * every one of them a card of its own in the library, as Duplicates does,
 * so one that is another movie can then be put right with Fix match on its
 * own page. Once the movie is split in the library its other cards are
 * listed, each a link to its page, with Put back together to put every
 * file on one card again.
 */
export const MovieFiles = ({
  files,
  everyCard,
  itemId,
}: {
  /** The card's files; there is always at least one. */
  files: readonly [MediaItem, ...MediaItem[]]
  /** The movie's files in the library, on every card. */
  everyCard: readonly MediaItem[]
  itemId: number
}) => {
  const ids = { heading: useId(), others: useId() }
  const queryClient = useQueryClient()
  const [first] = files
  const { libraryId } = first
  const settle = () => afterSplit({ queryClient, libraryId })
  const split = useMutation({
    mutationFn: () => api.splitDuplicate({ libraryId, mediaId: first.id, how: 'apart' }),
    onSuccess: settle,
  })
  const join = useMutation({
    mutationFn: () => api.joinSplit({ libraryId, itemId }),
    onSuccess: settle,
  })
  const busy = split.isPending || join.isPending
  const failure = split.error ?? join.error
  const isShared = files.length > 1
  const others = otherCards({ files, everyCard })

  return (
    <section className={styles.files} aria-labelledby={ids.heading}>
      <h3 id={ids.heading} className={styles.heading}>
        {isShared ? plural({ n: files.length, one: 'file', many: 'files' }) : 'File'}
      </h3>
      <ul className={styles.list}>
        {files.map((file) => (
          <li key={file.id} className={styles.file}>
            {file.fileName}
          </li>
        ))}
      </ul>

      {isShared && (
        <div className={styles.split}>
          <Button icon="split" disabled={busy} onClick={() => split.mutate()}>
            Split apart
          </Button>
          <p className={styles.hint}>
            Gives each file a card of its own in this library. One that is another movie can then be
            fixed with Fix match on its own page.
          </p>
        </div>
      )}

      {others.length > 0 && (
        <section className={styles.others} aria-labelledby={ids.others}>
          <h4 id={ids.others} className={styles.heading}>
            On cards of their own
          </h4>
          <ul className={styles.list}>
            {others.map((card) => {
              const [lead] = card
              return (
                lead && (
                  <li key={lead.id} className={styles.file}>
                    <Link to={cardLink({ media: lead, pages: true }).to} className={styles.card}>
                      {card.map((file) => file.fileName).join(', ')}
                    </Link>
                  </li>
                )
              )
            })}
          </ul>
          <div className={styles.split}>
            <Button icon="merge" disabled={busy} onClick={() => join.mutate()}>
              Put back together
            </Button>
          </div>
        </section>
      )}

      {failure && (
        <p className={styles.error} role="alert">
          {failure.message}
        </p>
      )}
      {split.isSuccess && (
        <output className={styles.note}>Each file has a card of its own now.</output>
      )}
      {join.isSuccess && <output className={styles.note}>Every file is back on one card.</output>}
    </section>
  )
}

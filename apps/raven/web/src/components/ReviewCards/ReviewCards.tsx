import { type Review, timeAgo } from '@raven/core'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@raven/ui'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { api } from '@/lib/api'
import styles from '@/components/ReviewCards/ReviewCards.module.scss'

/** How many reviews a page shows. */
const SHOWN = 10

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1))
    .slice(0, 2)
    .join('')
    .toUpperCase()

const score = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

type ScoreProps = { rating: number }

/** A reviewer's score out of 10, in the serif, read out in full. */
const Score = ({ rating }: ScoreProps) => (
  <span className={styles.score}>
    <span aria-hidden="true">
      {score.format(rating)}
      <span className={styles.outOf}>/10</span>
    </span>
    <span className="visually-hidden">{score.format(rating)} out of 10</span>
  </span>
)

type AvatarProps = { review: Review }

const Avatar = ({ review }: AvatarProps) => {
  const [failed, setFailed] = useState(false)
  const url = api.reviewAvatarUrl({ reviewId: review.id, avatarVersion: review.avatarVersion })
  return (
    <span className={styles.avatar}>
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials(review.author)}</span>
      )}
    </span>
  )
}

type ReviewDialogProps = { review: Review; onClose: () => void }

/** The whole review, as paragraphs, with a link to it on TMDB. Never rendered as HTML. */
const ReviewDialog = ({ review, onClose }: ReviewDialogProps) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onClose={onClose}>
      <div className={styles.dialogBody}>
        <header className={styles.head}>
          <Avatar review={review} />
          <h2 id={id} className={styles.dialogTitle}>
            {review.author}
          </h2>
          <span className={styles.when}>{timeAgo({ at: review.writtenAt })}</span>
          {review.rating != null && <Score rating={review.rating} />}
        </header>
        <p className={styles.whole}>{review.content}</p>
        <footer className={styles.dialogActions}>
          <a href={review.url} target="_blank" rel="noreferrer" className={styles.link}>
            Read on TMDB
          </a>
          <Button onClick={onClose}>Close</Button>
        </footer>
      </div>
    </dialog>
  )
}

type ReviewCardProps = { review: Review }

const ReviewCard = ({ review }: ReviewCardProps) => {
  const [open, setOpen] = useState(false)
  return (
    <li className={styles.card}>
      <span className={styles.head}>
        <Avatar review={review} />
        <span className={styles.author}>{review.author}</span>
        <span className={styles.when}>{timeAgo({ at: review.writtenAt })}</span>
        {review.rating != null && <Score rating={review.rating} />}
      </span>
      <p className={styles.text}>{review.content}</p>
      <Button tone="ghost" className={styles.read} onClick={() => setOpen(true)}>
        Read
      </Button>
      {open && <ReviewDialog review={review} onClose={() => setOpen(false)} />}
    </li>
  )
}

type ReviewCardsProps = { reviews: readonly Review[] }

/**
 * Reviews by TMDB members, newest first, up to ten, each a card on the
 * canopy: who wrote it and when, their score out of 10, the first lines,
 * and Read for the whole thing.
 */
export const ReviewCards = ({ reviews }: ReviewCardsProps) => {
  const id = useId()
  if (reviews.length === 0) return null
  return (
    <section className={styles.section} aria-labelledby={id}>
      <SectionHeading id={id}>Reviews from TMDB members</SectionHeading>
      <ul className={styles.list}>
        {reviews.slice(0, SHOWN).map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </ul>
    </section>
  )
}

import { type Review, timeAgo } from '@raven/core'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/Button/Button'
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

/** A score out of 10 as stars out of five, halves allowed: 7 becomes 3.5. */
export const starsOf = (rating: number): number => Math.round(rating) / 2

const Stars = ({ rating }: { rating: number }) => {
  const stars = starsOf(rating)
  return (
    <span className={styles.stars}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={
            stars >= star
              ? styles.starFull
              : stars >= star - 0.5
                ? styles.starHalf
                : styles.starEmpty
          }
          aria-hidden="true"
        >
          ★
        </span>
      ))}
      <span className="visually-hidden">{stars} out of 5 stars</span>
    </span>
  )
}

const Avatar = ({ review }: { review: Review }) => {
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

/** The whole review, as paragraphs, with a link to it on TMDB. Never rendered as HTML. */
const ReviewDialog = ({ review, onClose }: { review: Review; onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onClose={onClose}>
      <div className={styles.dialogBody}>
        <header className={styles.dialogHeader}>
          <Avatar review={review} />
          <h2 id={id} className={styles.dialogTitle}>
            {review.author}
          </h2>
          <span className={styles.when}>{timeAgo({ at: review.writtenAt })}</span>
          {review.rating != null && <Stars rating={review.rating} />}
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

const ReviewCard = ({ review }: { review: Review }) => {
  const [open, setOpen] = useState(false)
  return (
    <li className={styles.card}>
      <Avatar review={review} />
      <span className={styles.author}>{review.author}</span>
      <span className={styles.when}>{timeAgo({ at: review.writtenAt })}</span>
      {review.rating != null && <Stars rating={review.rating} />}
      <p className={styles.text}>{review.content}</p>
      <Button className={styles.read} onClick={() => setOpen(true)}>
        Read
      </Button>
      {open && <ReviewDialog review={review} onClose={() => setOpen(false)} />}
    </li>
  )
}

/** Reviews by TMDB members, newest first, up to ten, each as a card with Read for the whole thing. */
export const ReviewCards = ({ reviews }: { reviews: readonly Review[] }) => {
  const id = useId()
  if (reviews.length === 0) return null
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        Reviews from TMDB members
      </h2>
      <ul className={styles.list}>
        {reviews.slice(0, SHOWN).map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </ul>
    </section>
  )
}

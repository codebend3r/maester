import { type Review, timeAgo } from '@raven/core'
import { type ComponentType, useId, useState } from 'react'
import { Button } from '@raven/ui'
import { REVIEW_CARDS_COPY } from '@/components/ReviewCards/copy'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { api } from '@/lib/api'
import { useModal } from '@/lib/useModal'
import styles from '@/components/ReviewCards/ReviewCards.module.scss'
import { COMMON_COPY } from '@/lib/copy'

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
      <span className={styles.outOf}>{REVIEW_CARDS_COPY.outOfTen}</span>
    </span>
    <span className="visually-hidden">{REVIEW_CARDS_COPY.scoreOutOfTen(score.format(rating))}</span>
  </span>
)

/** Whether a reviewer shows their picture, or their initials where it is missing or failed. */
const AVATAR_KINDS = { picture: 'picture', initials: 'initials' } as const
type AvatarKind = (typeof AVATAR_KINDS)[keyof typeof AVATAR_KINDS]

type AvatarViewProps = { url: string | null; author: string; onError: () => void }

type AvatarPictureProps = AvatarViewProps

const AvatarPicture = ({ url, onError }: AvatarPictureProps) => (
  <img src={url ?? undefined} alt="" loading="lazy" decoding="async" onError={onError} />
)

type AvatarInitialsProps = AvatarViewProps

const AvatarInitials = ({ author }: AvatarInitialsProps) => (
  <span aria-hidden="true">{initials(author)}</span>
)

const AVATAR_VIEWS = {
  [AVATAR_KINDS.picture]: AvatarPicture,
  [AVATAR_KINDS.initials]: AvatarInitials,
} as const satisfies Record<AvatarKind, ComponentType<AvatarViewProps>>

type AvatarProps = { review: Review }

const Avatar = ({ review }: AvatarProps) => {
  const [failed, setFailed] = useState(false)
  const url = api.reviewAvatarUrl({ reviewId: review.id, avatarVersion: review.avatarVersion })
  const View = AVATAR_VIEWS[url && !failed ? AVATAR_KINDS.picture : AVATAR_KINDS.initials]
  return (
    <span className={styles.avatar}>
      <View url={url} author={review.author} onError={() => setFailed(true)} />
    </span>
  )
}

type ReviewDialogProps = { review: Review; onClose: () => void }

/** The whole review, as paragraphs, with a link to it on TMDB. Never rendered as HTML. */
const ReviewDialog = ({ review, onClose }: ReviewDialogProps) => {
  const { dialog } = useModal()
  const id = useId()
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
            {REVIEW_CARDS_COPY.readOnTmdb}
          </a>
          <Button onClick={onClose}>{COMMON_COPY.close}</Button>
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
        {REVIEW_CARDS_COPY.read}
      </Button>
      {open && <ReviewDialog review={review} onClose={() => setOpen(false)} />}
    </li>
  )
}

type ReviewListProps = { reviews: readonly Review[] }

const ReviewList = ({ reviews }: ReviewListProps) => {
  const id = useId()
  return (
    <section className={styles.section} aria-labelledby={id}>
      <SectionHeading id={id}>{REVIEW_CARDS_COPY.heading}</SectionHeading>
      <ul className={styles.list}>
        {reviews.slice(0, SHOWN).map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </ul>
    </section>
  )
}

type ReviewCardsProps = { reviews: readonly Review[] }

/**
 * Reviews by TMDB members, newest first, up to ten, each a card on the
 * canopy: who wrote it and when, their score out of 10, the first lines,
 * and Read for the whole thing.
 */
export const ReviewCards = ({ reviews }: ReviewCardsProps) =>
  reviews.length > 0 && <ReviewList reviews={reviews} />

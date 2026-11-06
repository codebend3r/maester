import type { ReactNode } from 'react'
import { COMMON_COPY } from '@/lib/copy'
import styles from '@/components/Skeleton/Skeleton.module.scss'

/** What a stand-in stands in for: a picture, a line of type at one size, or a button. */
const SHAPES = {
  poster: styles.poster,
  frame: styles.frame,
  fill: styles.fill,
  square: styles.square,
  hero: styles.hero,
  heading: styles.heading,
  text: styles.text,
  small: styles.small,
  button: styles.button,
} as const

/** How much of its row a line takes, so a run of them reads as ragged text. */
const WIDTHS = {
  most: styles.most,
  half: styles.half,
  short: styles.short,
} as const

type BoneProps = {
  shape: keyof typeof SHAPES
  width?: keyof typeof WIDTHS
}

/**
 * One grey stand-in for something on its way. Without a `width` it takes
 * what its container gives it, or a button's own.
 */
export const Bone = ({ shape, width }: BoneProps) => (
  <span
    className={
      width ? `${styles.bone} ${SHAPES[shape]} ${WIDTHS[width]}` : `${styles.bone} ${SHAPES[shape]}`
    }
  />
)

type SkeletonCardProps = { picture: 'poster' | 'frame' }

/** A card on its way: its picture, a line for its title and one for its facts. */
const SkeletonCard = ({ picture }: SkeletonCardProps) => (
  <li className={styles.card}>
    <Bone shape={picture} />
    <Bone shape="text" width="most" />
    <Bone shape="small" width="short" />
  </li>
)

type SkeletonCardsProps = {
  picture: 'poster' | 'frame'
  count?: number
}

/**
 * `count` cards on their way, for a grid that lays its own cards out. Stand-ins
 * have nothing to tell them apart, so each is keyed by its place.
 */
export const SkeletonCards = ({ picture, count = 12 }: SkeletonCardsProps) =>
  Array.from({ length: count }, (_, index) => <SkeletonCard key={index} picture={picture} />)

type SkeletonPanelProps = {
  /** The real card's layout class, so the stand-in takes its size and places its lines as it does. */
  className: string
  children: ReactNode
}

/**
 * A card drawn on its picture (a binged title, a tile in progress) on its
 * way: the card's whole shape in grey, its lines lighter on it.
 */
export const SkeletonPanel = ({ className, children }: SkeletonPanelProps) => (
  <li className={`${styles.bone} ${styles.panel} ${className}`}>{children}</li>
)

type LoadingProps = { label: string; children: ReactNode }

/**
 * What a page or a part of one shows while what it needs is on its way: the
 * shape of what is coming, which a screen reader skips for `label`. The
 * label is plain text rather than a live region, which many screen readers
 * leave unread when it arrives already filled.
 */
export const Loading = ({ label, children }: LoadingProps) => (
  <div className={styles.loading}>
    <p className="visually-hidden">{label}</p>
    <div className={styles.shapes} aria-hidden="true">
      {children}
    </div>
  </div>
)

/**
 * A page whose code is still on its way, inside the shell: the way back, its
 * title and a grid of cards. Each page swaps in its own shape once it runs.
 */
export const PageSkeleton = () => (
  <Loading label={COMMON_COPY.loading}>
    <div className={styles.page}>
      <Bone shape="button" />
      <Bone shape="hero" width="half" />
      <ul className={styles.grid}>
        <SkeletonCards picture="poster" />
      </ul>
    </div>
  </Loading>
)

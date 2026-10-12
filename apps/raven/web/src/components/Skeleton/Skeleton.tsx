import type { ReactNode } from 'react'
import styles from '@/components/Skeleton/Skeleton.module.scss'

/** What a stand-in stands in for: a picture, a line of type at one size, or a button. */
const SHAPES = {
  poster: styles.poster,
  frame: styles.frame,
  fill: styles.fill,
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

/** The shape of a card's picture: a poster, or a frame grab. */
export type CardPicture = 'poster' | 'frame'

/**
 * One grey stand-in for something on its way. Without a `width` it takes
 * what its container gives it, or a button's own.
 */
export const Bone = ({
  shape,
  width,
}: {
  shape: keyof typeof SHAPES
  width?: keyof typeof WIDTHS
}) => (
  <span
    className={
      width ? `${styles.bone} ${SHAPES[shape]} ${WIDTHS[width]}` : `${styles.bone} ${SHAPES[shape]}`
    }
  />
)

/** A card on its way: its picture, a line for its title and one for its facts. */
const SkeletonCard = ({ picture }: { picture: CardPicture }) => (
  <li className={styles.card}>
    <Bone shape={picture} />
    <Bone shape="text" width="most" />
    <Bone shape="small" width="short" />
  </li>
)

/** A row on its way, as a list or tiles lays a video out: a frame grab beside two lines. */
const SkeletonRow = () => (
  <li className={styles.row}>
    <Bone shape="frame" />
    <span className={styles.lines}>
      <Bone shape="text" width="half" />
      <Bone shape="small" width="short" />
    </span>
  </li>
)

/**
 * `count` cards on their way, for a grid that lays its own cards out. Stand-ins
 * have nothing to tell them apart, so each is keyed by its place.
 */
export const SkeletonCards = ({ picture, count = 12 }: { picture: CardPicture; count?: number }) =>
  Array.from({ length: count }, (_, index) => <SkeletonCard key={index} picture={picture} />)

/** `count` rows on their way, for a list that lays its own rows out. */
export const SkeletonRows = ({ count = 6 }: { count?: number }) =>
  Array.from({ length: count }, (_, index) => <SkeletonRow key={index} />)

/**
 * What a page or a part of one shows while what it needs is on its way: the
 * shape of what is coming, which a screen reader skips for `label`.
 */
export const Loading = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className={styles.loading}>
    <output className="visually-hidden">{label}</output>
    <div className={styles.shapes} aria-hidden="true">
      {children}
    </div>
  </div>
)

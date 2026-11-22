import { KIT_COPY } from '@raven/wren'
import type { ComponentType } from 'react'
import { TileGrid } from '@/ui/TileGrid/TileGrid'
import styles from '@/components/ListSkeleton/ListSkeleton.module.scss'

/** What a list's entries look like, so the stand-in has their shape: tiles of covers, or rows of songs. */
export const LIST_SHAPES = { tiles: 'tiles', rows: 'rows' } as const

export type ListShape = (typeof LIST_SHAPES)[keyof typeof LIST_SHAPES]

const BONES = 12

const PLACES = Array.from({ length: BONES }, (_, place) => place)

const TileBones = () => (
  <TileGrid
    items={PLACES}
    keyOf={(place) => place}
    renderTile={() => (
      <span className={styles.tile}>
        <span className={styles.cover} />
        <span className={styles.line} />
        <span className={styles.shortLine} />
      </span>
    )}
  />
)

const RowBones = () => (
  <ul className={styles.rows}>
    {PLACES.map((place) => (
      <li className={styles.row} key={place}>
        <span className={styles.art} />
        <span className={styles.text}>
          <span className={styles.line} />
          <span className={styles.shortLine} />
        </span>
      </li>
    ))}
  </ul>
)

const SHAPE_BONES = {
  [LIST_SHAPES.tiles]: TileBones,
  [LIST_SHAPES.rows]: RowBones,
} as const satisfies Record<ListShape, ComponentType>

type ListSkeletonProps = { shape: ListShape }

/** Grey stand-ins in the shape of a list's entries while it is read; the words are for a screen reader alone. */
export function ListSkeleton({ shape }: ListSkeletonProps) {
  const Bones = SHAPE_BONES[shape]
  return (
    <output aria-live="polite" className={styles.skeleton}>
      <span className={styles.label}>{KIT_COPY.loading}</span>
      <span aria-hidden="true" className={styles.bones}>
        <Bones />
      </span>
    </output>
  )
}

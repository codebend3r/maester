import type { MixSummary } from '@raven/core'
import { Link } from 'react-router-dom'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { COMMON_COPY, MUSIC_COPY } from '@/lib/copy'
import { mixFacts, mixPath } from '@/lib/music'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/MixGrid/MixGrid.module.scss'

type MixCoversProps = { mix: MixSummary }

/** Up to four of a mix's album covers, as one square. */
export const MixCovers = ({ mix }: MixCoversProps) => (
  <span className={styles.covers}>
    {mix.covers.slice(0, 4).map((cover) => (
      <span key={cover.albumId} className={styles.tile}>
        <AlbumCover
          album={{
            id: cover.albumId,
            title: MUSIC_COPY.mixNames[mix.id],
            coverVersion: cover.coverVersion,
          }}
          sizes={POSTER_SIZES.grid}
        />
      </span>
    ))}
  </span>
)

type MixCardProps = { mix: MixSummary }

const MixCard = ({ mix }: MixCardProps) => (
  <li className={styles.card}>
    {/* The name under it is the link read aloud; the covers are the same link for the pointer. */}
    <Link to={mixPath(mix.id)} className={styles.cover} aria-hidden="true" tabIndex={-1}>
      <MixCovers mix={mix} />
    </Link>
    <p className={styles.name}>
      <Link to={mixPath(mix.id)}>{MUSIC_COPY.mixNames[mix.id]}</Link>
    </p>
    <p className={styles.facts}>{mixFacts({ mix }).join(COMMON_COPY.separator)}</p>
  </li>
)

type MixGridProps = { mixes: readonly MixSummary[]; label: string }

/** The account's mixes as cards: four covers each, the mix's name and length. */
export const MixGrid = ({ mixes, label }: MixGridProps) => (
  <ul className={styles.grid} aria-label={label}>
    {mixes.map((mix) => (
      <MixCard key={mix.id} mix={mix} />
    ))}
  </ul>
)

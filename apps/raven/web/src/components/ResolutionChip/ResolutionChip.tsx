import { type MediaItem, resolutionLabel } from '@raven/core'
import type { ReactNode } from 'react'
import styles from '@/components/ResolutionChip/ResolutionChip.module.scss'

/** A short label on glass over a picture: a resolution, HDR. */
export const PictureChip = ({ label, children }: { label?: string; children: ReactNode }) => (
  <span className={styles.chip} aria-label={label}>
    {children}
  </span>
)

/** A video's resolution as a compact mark over its picture. */
export const ResolutionChip = ({ media }: { media: MediaItem }) => {
  const resolution = resolutionLabel(media)
  if (resolution == null) return null
  return <PictureChip label={`Video resolution: ${resolution}`}>{resolution}</PictureChip>
}

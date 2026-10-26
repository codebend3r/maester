import { type MediaItem, RESOLUTIONS, type Resolution, resolutionLabel } from '@raven/core'
import type { ReactNode } from 'react'
import styles from '@/components/ResolutionChip/ResolutionChip.module.scss'

type PictureChipProps = {
  label?: string
  className?: string
  children: ReactNode
}

/** A short label on glass over a picture: a resolution, HDR. */
export const PictureChip = ({ label, className, children }: PictureChipProps) => (
  <span className={className ? `${styles.chip} ${className}` : styles.chip} aria-label={label}>
    {children}
  </span>
)

/** Each tier's own colour; SD stays on plain glass. */
const TIERS: Record<Resolution, string | undefined> = {
  [RESOLUTIONS.sd]: undefined,
  [RESOLUTIONS.p320]: styles.p320,
  [RESOLUTIONS.p480]: styles.p480,
  [RESOLUTIONS.p720]: styles.hd,
  [RESOLUTIONS.p1080]: styles.fullHd,
  [RESOLUTIONS.uhd]: styles.uhd,
  [RESOLUTIONS.uhd8k]: styles.uhd8k,
}

type ResolutionChipProps = { media: MediaItem }

/** A video's resolution as a compact mark over its picture, coloured by its tier. */
export const ResolutionChip = ({ media }: ResolutionChipProps) => {
  const resolution = resolutionLabel(media)
  if (resolution == null) return null
  return (
    <PictureChip label={`Video resolution: ${resolution}`} className={TIERS[resolution]}>
      {resolution}
    </PictureChip>
  )
}

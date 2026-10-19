import { type MediaItem, RESOLUTIONS, type Resolution, resolutionLabel } from '@raven/core'
import type { ReactNode } from 'react'
import styles from '@/components/ResolutionChip/ResolutionChip.module.scss'

/** A short label on glass over a picture: a resolution, HDR. */
export const PictureChip = ({
  label,
  className,
  children,
}: {
  label?: string
  className?: string
  children: ReactNode
}) => (
  <span className={className ? `${styles.chip} ${className}` : styles.chip} aria-label={label}>
    {children}
  </span>
)

/** Each HD tier's own colour; SD and 480p stay on plain glass. */
const TIERS: Record<Resolution, string | undefined> = {
  [RESOLUTIONS.sd]: undefined,
  [RESOLUTIONS.p480]: undefined,
  [RESOLUTIONS.p720]: styles.hd,
  [RESOLUTIONS.p1080]: styles.fullHd,
  [RESOLUTIONS.uhd]: styles.uhd,
  [RESOLUTIONS.uhd8k]: styles.uhd8k,
}

/** A video's resolution as a compact mark over its picture, coloured by its tier. */
export const ResolutionChip = ({ media }: { media: MediaItem }) => {
  const resolution = resolutionLabel(media)
  if (resolution == null) return null
  return (
    <PictureChip label={`Video resolution: ${resolution}`} className={TIERS[resolution]}>
      {resolution}
    </PictureChip>
  )
}

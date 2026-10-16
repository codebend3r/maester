import { type MediaItem, resolutionLabel } from '@raven/core'
import styles from '@/components/ResolutionChip/ResolutionChip.module.scss'

/** A video's resolution as a compact mark over its picture. */
export const ResolutionChip = ({ media, className }: { media: MediaItem; className?: string }) => {
  const resolution = resolutionLabel(media)
  if (resolution == null) return null
  return (
    <span
      className={className ? `${styles.chip} ${className}` : styles.chip}
      aria-label={`Video resolution: ${resolution}`}
    >
      {resolution}
    </span>
  )
}

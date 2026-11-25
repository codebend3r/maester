import type { AudioQuality } from '@raven/core'
import { qualityViewOf } from '@raven/wren'
import styles from '@/ui/QualityChips/QualityChips.module.scss'

type QualityChipsProps = {
  /** The format and quality of what is playing. */
  quality: AudioQuality
}

/**
 * The format and quality of what is playing: a chip for the format, one for a lossless file's
 * bit depth, then the rest as quiet words. A screen reader hears it once, as one sentence.
 */
export function QualityChips({ quality }: QualityChipsProps) {
  const { chips, facts, label } = qualityViewOf(quality)
  return (
    <span aria-label={label} className={styles.quality} role="note">
      <span aria-hidden="true" className={styles.chips}>
        {chips.map((chip) => (
          <span className={styles.chip} key={chip}>
            {chip}
          </span>
        ))}
      </span>
      {facts !== null && (
        <span aria-hidden="true" className={styles.facts}>
          {facts}
        </span>
      )}
    </span>
  )
}

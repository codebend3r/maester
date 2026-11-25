import { type AudioQuality, qualityChipsOf, qualityRestOf } from '@raven/core'
import { PictureChip, classNames } from '@raven/ui'
import { AUDIO_QUALITY_COPY } from '@/components/AudioQualityLine/copy'
import styles from '@/components/AudioQualityLine/AudioQualityLine.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type AudioQualityLineProps = { quality: AudioQuality; className: string }

/**
 * The format and quality of what is playing: the format and a lossless file's bit depth as
 * chips, then the rest as quiet words. A screen reader hears the line as one sentence, since
 * the chips are marks, not controls.
 */
export const AudioQualityLine = ({ quality, className }: AudioQualityLineProps) => {
  const chips = qualityChipsOf(quality)
  const rest = qualityRestOf(quality)
  return (
    <p className={classNames([styles.line, className])}>
      <span className="visually-hidden">{AUDIO_QUALITY_COPY.label([...chips, ...rest])}</span>
      <span className={styles.chips} aria-hidden="true">
        {chips.map((chip) => (
          <PictureChip key={chip}>{chip}</PictureChip>
        ))}
      </span>
      {rest.length > 0 && (
        <span className={styles.rest} aria-hidden="true">
          {rest.join(COMMON_COPY.separator)}
        </span>
      )}
    </p>
  )
}

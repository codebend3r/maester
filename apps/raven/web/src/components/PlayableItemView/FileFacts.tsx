import { type MediaItem, type MediaTracks, allFileFacts } from '@raven/core'
import { useId } from 'react'
import styles from '@/components/PlayableItemView/FileFacts.module.scss'

/**
 * The file Play starts, as a list of facts on hairline rows: its video,
 * audio and subtitles, then its container, bitrate and size. `className`
 * places it.
 */
export const FileFacts = ({
  media,
  tracks,
  className,
}: {
  media: MediaItem
  tracks: MediaTracks | undefined
  className?: string
}) => {
  const id = useId()
  return (
    <section className={className} aria-labelledby={id}>
      <h2 id={id} className="visually-hidden">
        File
      </h2>
      <dl className={styles.facts}>
        {allFileFacts({ media, tracks }).map((fact) => (
          <div key={fact.label} className={styles.fact}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

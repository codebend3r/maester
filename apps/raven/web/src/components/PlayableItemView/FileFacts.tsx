import { type MediaItem, type MediaTracks, formatBitrate, formatBytes } from '@raven/core'
import { useId } from 'react'
import { fileFacts } from '@/lib/itemFacts'
import styles from '@/components/PlayableItemView/FileFacts.module.scss'

/** The file's facts as label and value: its tracks, then its container, bitrate and size. */
export const allFileFacts = ({
  media,
  tracks,
}: {
  media: MediaItem
  tracks: MediaTracks | undefined
}): Array<{ label: string; value: string }> =>
  [
    ...fileFacts({ media, tracks }),
    { label: 'Container', value: media.container.toUpperCase() },
    { label: 'Bitrate', value: formatBitrate(media.bitrate) ?? '' },
    { label: 'Size', value: formatBytes(media.size) },
  ].filter((fact) => fact.value !== '')

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

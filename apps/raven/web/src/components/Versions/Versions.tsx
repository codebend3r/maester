import { type Library, type MediaItem, codecLabel, formatBytes, resolutionLabel } from '@raven/core'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import styles from '@/components/Versions/Versions.module.scss'

/** Every file that is this movie, best first, each playable on its own. Shown only when there is more than one. */
export const Versions = ({
  versions,
  libraries,
}: {
  versions: readonly MediaItem[]
  libraries: readonly Library[]
}) => {
  const id = useId()
  if (versions.length < 2) return null
  const libraryName = (libraryId: number) =>
    libraries.find((library) => library.id === libraryId)?.name ?? ''
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        Versions
      </h2>
      <ul className={styles.list}>
        {versions.map((version) => {
          const facts = [
            resolutionLabel(version),
            version.hdr ? 'HDR' : null,
            version.videoCodec ? codecLabel(version.videoCodec) : null,
            formatBytes(version.size),
            version.edition,
            libraryName(version.libraryId),
          ].filter((fact): fact is string => fact != null && fact !== '')
          return (
            <li key={version.id} className={styles.version}>
              <span className={styles.facts}>
                {facts.map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
              </span>
              <span className={styles.file}>{version.fileName}</span>
              <Link
                to={`/watch/${version.id}`}
                state={{ media: version }}
                className={styles.play}
                aria-label={`Play ${version.fileName}`}
              >
                <Icon name="play" size={16} />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

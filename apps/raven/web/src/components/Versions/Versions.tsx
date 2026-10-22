import { type Library, type MediaItem, versionFacts, watchPageOf } from '@raven/core'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@raven/ui'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import styles from '@/components/Versions/Versions.module.scss'

/**
 * Every file that is this movie, best first, each on a ruled row: what sets
 * it apart as chips, its file name, and a round button that plays it.
 * Shown only when there is more than one.
 */
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
      <SectionHeading id={id}>Versions</SectionHeading>
      <ul className={styles.list}>
        {versions.map((version) => {
          const facts = [
            ...versionFacts(version),
            version.edition,
            libraryName(version.libraryId),
          ].filter((fact): fact is string => fact != null && fact !== '')
          return (
            <li key={version.id} className={styles.version}>
              <span className={styles.facts}>
                {facts.map((fact) => (
                  <span key={fact} className={styles.chip}>
                    {fact}
                  </span>
                ))}
              </span>
              <span className={styles.file}>{version.fileName}</span>
              <Link
                to={watchPageOf(version.id)}
                state={{ media: version }}
                className={styles.play}
                aria-label={`Play ${version.fileName}`}
              >
                <Icon name="play" size={14} />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

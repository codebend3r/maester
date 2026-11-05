import {
  FACT_PART_KINDS,
  type FactPartKind,
  type Library,
  type MediaItem,
  versionFacts,
  watchPageOf,
  wordPart,
} from '@raven/core'
import { type ComponentType, useId } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@raven/ui'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { WordFact } from '@/components/ResolutionChip/ResolutionChip'
import { VERSIONS_COPY } from '@/components/Versions/copy'
import styles from '@/components/Versions/Versions.module.scss'

type FactViewProps = { fact: string }

/** A resolution, codec or range, drawn as its own chip. */
const PictureWord = ({ fact }: FactViewProps) => <WordFact fact={fact} />

/** Plain words (the size, an edition, a library) in a chip of their own. */
const WordsFact = ({ fact }: FactViewProps) => <span className={styles.chip}>{fact}</span>

const FACT_VIEWS = {
  [FACT_PART_KINDS.resolution]: PictureWord,
  [FACT_PART_KINDS.codec]: PictureWord,
  [FACT_PART_KINDS.range]: PictureWord,
  [FACT_PART_KINDS.text]: WordsFact,
} as const satisfies Record<FactPartKind, ComponentType<FactViewProps>>

type VersionFactProps = { fact: string }

const VersionFact = ({ fact }: VersionFactProps) => {
  const View = FACT_VIEWS[wordPart(fact).kind]
  return <View fact={fact} />
}

type VersionsProps = {
  versions: readonly MediaItem[]
  libraries: readonly Library[]
}

type VersionListProps = VersionsProps

const VersionList = ({ versions, libraries }: VersionListProps) => {
  const id = useId()
  const libraryName = (libraryId: number) =>
    libraries.find((library) => library.id === libraryId)?.name ?? ''
  return (
    <section className={styles.section} aria-labelledby={id}>
      <SectionHeading id={id}>{VERSIONS_COPY.versions}</SectionHeading>
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
                  <VersionFact key={fact} fact={fact} />
                ))}
              </span>
              <span className={styles.file}>{version.fileName}</span>
              <Link
                to={watchPageOf(version.id)}
                state={{ media: version }}
                className={styles.play}
                aria-label={VERSIONS_COPY.play(version.fileName)}
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

/**
 * Every file that is this movie, best first, each on a ruled row: what sets
 * it apart as chips, its file name, and a round button that plays it.
 * Shown only when there is more than one.
 */
export const Versions = ({ versions, libraries }: VersionsProps) =>
  versions.length >= 2 && <VersionList versions={versions} libraries={libraries} />

import {
  type Library,
  type MediaItem,
  type Resolution,
  isResolution,
  versionFacts,
  watchPageOf,
} from '@raven/core'
import { type ComponentType, useId } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@raven/ui'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import { VERSIONS_COPY } from '@/components/Versions/copy'
import styles from '@/components/Versions/Versions.module.scss'

/** Whether a fact is a resolution, drawn as its chip, or plain words in a chip of their own. */
const FACT_KINDS = { resolution: 'resolution', words: 'words' } as const

type FactKind = (typeof FACT_KINDS)[keyof typeof FACT_KINDS]

type FactViewProps = { fact: string; resolution: Resolution | null }

type ResolutionFactProps = FactViewProps

const ResolutionFact = ({ resolution }: ResolutionFactProps) => (
  <ResolutionChip resolution={resolution} />
)

type WordsFactProps = FactViewProps

const WordsFact = ({ fact }: WordsFactProps) => <span className={styles.chip}>{fact}</span>

const FACT_VIEWS = {
  [FACT_KINDS.resolution]: ResolutionFact,
  [FACT_KINDS.words]: WordsFact,
} as const satisfies Record<FactKind, ComponentType<FactViewProps>>

type VersionFactProps = { fact: string }

const VersionFact = ({ fact }: VersionFactProps) => {
  const resolution = isResolution(fact) ? fact : null
  const View: ComponentType<FactViewProps> =
    FACT_VIEWS[resolution === null ? FACT_KINDS.words : FACT_KINDS.resolution]
  return <View fact={fact} resolution={resolution} />
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

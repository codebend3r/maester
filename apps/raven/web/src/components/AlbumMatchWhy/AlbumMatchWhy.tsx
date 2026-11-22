import { useQuery } from '@tanstack/react-query'
import {
  type AlbumMatchDiagnosis,
  MATCH_FACTS,
  type MatchFact,
  type MatchFactCheck,
} from '@raven/core'
import { Icon } from '@raven/ui'
import { QueryView, keptRead } from '@raven/ui/headless'
import type { AlbumHintProps } from '@/components/AlbumGrid/AlbumGrid'
import { Spinner } from '@/components/Spinner/Spinner'
import { ALBUM_MATCH_WHY_COPY } from '@/components/AlbumMatchWhy/copy'
import { albumMatchDiagnosisQuery } from '@/lib/queries'
import styles from '@/components/AlbumMatchWhy/AlbumMatchWhy.module.scss'

/** How a fact stood against the closest release. */
const STANDINGS = { agrees: 'agrees', near: 'near', differs: 'differs' } as const

type Standing = (typeof STANDINGS)[keyof typeof STANDINGS]

const STANDING_ICONS = {
  [STANDINGS.agrees]: 'check',
  [STANDINGS.near]: 'alert',
  [STANDINGS.differs]: 'close',
} as const satisfies Record<Standing, 'check' | 'alert' | 'close'>

const standingOf = ({ points, most }: MatchFactCheck): Standing => {
  if (points >= most) return STANDINGS.agrees
  return points > 0 ? STANDINGS.near : STANDINGS.differs
}

/** What a fact's line says under its name: both sides when they differ, the status for an official release. */
const detailOf = (check: MatchFactCheck): string | null => {
  if (check.fact === MATCH_FACTS.official) {
    return check.points > 0 ? ALBUM_MATCH_WHY_COPY.official : ALBUM_MATCH_WHY_COPY.notOfficial
  }
  if (standingOf(check) === STANDINGS.agrees) return null
  return ALBUM_MATCH_WHY_COPY.values({
    album: check.album ?? ALBUM_MATCH_WHY_COPY.noValue,
    release: check.release ?? ALBUM_MATCH_WHY_COPY.noValue,
  })
}

type FactLineProps = { check: MatchFactCheck }

const FactLine = ({ check }: FactLineProps) => {
  const standing = standingOf(check)
  const detail = detailOf(check)
  return (
    <li className={`${styles.fact} ${styles[standing]}`}>
      <Icon name={STANDING_ICONS[standing]} size={14} />
      <span className={styles.factName}>{ALBUM_MATCH_WHY_COPY.facts[check.fact]}</span>
      <span className={styles.points}>{ALBUM_MATCH_WHY_COPY.points(check)}</span>
      {detail !== null && <span className={styles.detail}>{detail}</span>}
    </li>
  )
}

/** The facts a fix can be read off: all but whether the release is official. */
const FIXABLE = [
  MATCH_FACTS.title,
  MATCH_FACTS.artist,
  MATCH_FACTS.year,
  MATCH_FACTS.trackCount,
] as const satisfies readonly MatchFact[]

/** A fact that differs from a release that says what it should be. */
type FixableCheck = MatchFactCheck & { fact: (typeof FIXABLE)[number]; release: string }

const isFixableCheck = (check: MatchFactCheck): check is FixableCheck =>
  FIXABLE.some((fact) => fact === check.fact) &&
  check.release !== null &&
  standingOf(check) !== STANDINGS.agrees

/** A fix read off the first fact that differs, the title first, for when smart match has not said one. */
const fixOf = ({ closest, facts }: AlbumMatchDiagnosis): string => {
  if (closest === null) return ALBUM_MATCH_WHY_COPY.fixNothingFound
  const first = facts.find(isFixableCheck)
  return first === undefined
    ? ALBUM_MATCH_WHY_COPY.fixOtherwise
    : ALBUM_MATCH_WHY_COPY.fixes[first.fact](first.release)
}

type DiagnosisProps = { diagnosis: AlbumMatchDiagnosis }

const Diagnosis = ({ diagnosis }: DiagnosisProps) => {
  const { closest, facts, reason, fix } = diagnosis
  return (
    <>
      <header className={styles.head}>
        <strong>
          {closest
            ? ALBUM_MATCH_WHY_COPY.score(closest.confidence)
            : ALBUM_MATCH_WHY_COPY.nothingFound}
        </strong>
        {closest && <span className={styles.closest}>{ALBUM_MATCH_WHY_COPY.closest(closest)}</span>}
      </header>
      {facts.length > 0 && (
        <ul className={styles.facts}>
          {facts.map((check) => (
            <FactLine key={check.fact} check={check} />
          ))}
        </ul>
      )}
      {reason !== null && (
        <p className={styles.reason}>
          <Icon name="wand" size={14} />
          <span>
            <strong>{ALBUM_MATCH_WHY_COPY.reason}</strong> {reason}
          </span>
        </p>
      )}
      <footer className={styles.fix}>
        <strong>{ALBUM_MATCH_WHY_COPY.fixHeading}</strong>
        <span>{fix ?? fixOf(diagnosis)}</span>
      </footer>
    </>
  )
}

/**
 * Why an unmatched album is unmatched, by the pointer while it is on its
 * card: how close the nearest MusicBrainz release came, each fact weighed
 * against it, smart match's reason, and at the bottom how to fix it. Asked
 * for the first time it is shown; the server keeps the answer.
 */
export const AlbumMatchWhy = ({ album, isShown, id }: AlbumHintProps) => {
  const diagnosis = useQuery(albumMatchDiagnosisQuery({ albumId: album.id, isWanted: isShown }))
  return (
    isShown && (
      <section id={id} role="tooltip" className={styles.popover}>
        <QueryView
          query={keptRead({ data: diagnosis.data, error: diagnosis.error })}
          pending={
            <p className={styles.status}>
              <Spinner />
              <span>{ALBUM_MATCH_WHY_COPY.looking}</span>
            </p>
          }
          renderFailed={(error) => (
            <p className={styles.status}>{ALBUM_MATCH_WHY_COPY.failed(error.message)}</p>
          )}
        >
          {(answer) => <Diagnosis diagnosis={answer} />}
        </QueryView>
      </section>
    )
  )
}

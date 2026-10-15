import type { Credit, CreditJob } from '@raven/core'
import { useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@raven/ui'
import { api } from '@/lib/api'
import styles from '@/components/CastRow/CastRow.module.scss'

/** A person once, with every role they have on this item. */
export type CastMember = {
  personId: number
  name: string
  roles: string[]
  photoVersion: string | null
}

const JOB_NAMES: Record<CreditJob, string> = {
  cast: 'Actor',
  guest: 'Guest star',
  director: 'Director',
  writer: 'Writer',
  creator: 'Creator',
  producer: 'Producer',
}

/**
 * Credits by person, in billing order: someone who acts and directs is one
 * entry, "Mark Kimball / Director". A crew role names the job in full
 * ("Screenplay") where TMDB gives one.
 */
export const castMembers = (credits: readonly Credit[]): CastMember[] => {
  const byPerson = credits.reduce((members, credit) => {
    const role = credit.role ?? JOB_NAMES[credit.job]
    const known = members.get(credit.personId)
    return members.set(credit.personId, {
      personId: credit.personId,
      name: credit.name,
      roles: known
        ? [...known.roles, role].filter((value, index, all) => all.indexOf(value) === index)
        : [role],
      photoVersion: known?.photoVersion ?? credit.photoVersion,
    })
  }, new Map<number, CastMember>())
  return [...byPerson.values()]
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1))
    .slice(0, 2)
    .join('')

/**
 * Cast & Crew: round photos in a row that scrolls sideways, snapping to each
 * person. The buttons scroll a page at a time; the list itself scrolls with
 * the keyboard too, since it takes focus.
 */
export const CastRow = ({
  credits,
  title = 'Cast & Crew',
}: {
  credits: readonly Credit[]
  title?: string
}) => {
  const id = useId()
  const list = useRef<HTMLUListElement>(null)
  const members = castMembers(credits)
  if (members.length === 0) return null

  const page = (direction: 1 | -1) => {
    const row = list.current
    if (!row) return
    row.scrollBy({ left: direction * row.clientWidth * 0.9, behavior: 'smooth' })
  }

  return (
    <section className={styles.section} aria-labelledby={id}>
      <header className={styles.header}>
        <h2 id={id} className={styles.heading}>
          {title}
        </h2>
        <div className={styles.buttons}>
          <Button icon="back" aria-label="Earlier in the cast" onClick={() => page(-1)} />
          <Button icon="next" aria-label="Later in the cast" onClick={() => page(1)} />
        </div>
      </header>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region must take focus to scroll by keyboard */}
      <ul ref={list} className={styles.row} tabIndex={0} aria-labelledby={id}>
        {members.map((member) => {
          const photo = api.photoUrl(member)
          return (
            <li key={member.personId} className={styles.person}>
              <Link to={`/people/${member.personId}`} className={styles.personLink}>
                <span className={styles.photo}>
                  {photo ? (
                    <img src={photo} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span aria-hidden="true">{initials(member.name)}</span>
                  )}
                </span>
                <span className={styles.name}>{member.name}</span>
                <span className={styles.role}>{member.roles.join(' / ')}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

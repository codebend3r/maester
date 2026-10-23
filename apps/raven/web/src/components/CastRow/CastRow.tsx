import { type Credit, castMembers, initialsOf } from '@raven/core'
import { useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@raven/ui'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { api } from '@/lib/api'
import styles from '@/components/CastRow/CastRow.module.scss'

/**
 * Cast & Crew: a ruled heading with round previous and next buttons beside
 * it, over large round photos (initials where TMDB has none) in a row that
 * scrolls sideways, snapping to each person, with name and role beneath.
 * The buttons scroll a page at a time; the list itself scrolls with the
 * keyboard too, since it takes focus.
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
      <SectionHeading
        id={id}
        aside={
          <>
            <Button
              tone="ghost"
              icon="back"
              aria-label="Earlier in the cast"
              className={styles.scroll}
              onClick={() => page(-1)}
            />
            <Button
              tone="ghost"
              icon="next"
              aria-label="Later in the cast"
              className={styles.scroll}
              onClick={() => page(1)}
            />
          </>
        }
      >
        {title}
      </SectionHeading>
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
                    <span aria-hidden="true">{initialsOf(member.name)}</span>
                  )}
                </span>
                <span className={styles.caption}>
                  <span className={styles.name}>{member.name}</span>
                  <span className={styles.role}>{member.roles.join(' / ')}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

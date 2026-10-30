import { type Credit, castMembers, initialsOf } from '@raven/core'
import { type ComponentType, useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@raven/ui'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { CAST_ROW_COPY } from '@/components/CastRow/copy'
import { api } from '@/lib/api'
import styles from '@/components/CastRow/CastRow.module.scss'

/** Whether a person shows their photo, or their initials where TMDB has none. */
const PHOTO_KINDS = { photo: 'photo', initials: 'initials' } as const
type PhotoKind = (typeof PHOTO_KINDS)[keyof typeof PHOTO_KINDS]

type PersonPhotoProps = { photo: string | null; name: string }

type PhotoProps = PersonPhotoProps

const Photo = ({ photo }: PhotoProps) => (
  <img src={photo ?? undefined} alt="" loading="lazy" decoding="async" />
)

type InitialsProps = PersonPhotoProps

const Initials = ({ name }: InitialsProps) => <span aria-hidden="true">{initialsOf(name)}</span>

const PERSON_PHOTOS = {
  [PHOTO_KINDS.photo]: Photo,
  [PHOTO_KINDS.initials]: Initials,
} as const satisfies Record<PhotoKind, ComponentType<PersonPhotoProps>>

type CastListProps = {
  members: ReturnType<typeof castMembers>
  title: string
}

const CastList = ({ members, title }: CastListProps) => {
  const id = useId()
  const list = useRef<HTMLUListElement>(null)

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
              aria-label={CAST_ROW_COPY.earlier}
              className={styles.scroll}
              onClick={() => page(-1)}
            />
            <Button
              tone="ghost"
              icon="next"
              aria-label={CAST_ROW_COPY.later}
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
          const PersonPhoto = PERSON_PHOTOS[photo ? PHOTO_KINDS.photo : PHOTO_KINDS.initials]
          return (
            <li key={member.personId} className={styles.person}>
              <Link to={`/people/${member.personId}`} className={styles.personLink}>
                <span className={styles.photo}>
                  <PersonPhoto photo={photo} name={member.name} />
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

type CastRowProps = {
  credits: readonly Credit[]
  title?: string
}

/**
 * Cast & Crew: a ruled heading with round previous and next buttons beside
 * it, over large round photos (initials where TMDB has none) in a row that
 * scrolls sideways, snapping to each person, with name and role beneath.
 * The buttons scroll a page at a time; the list itself scrolls with the
 * keyboard too, since it takes focus.
 */
export const CastRow = ({ credits, title = CAST_ROW_COPY.title }: CastRowProps) => {
  const members = castMembers(credits)
  return members.length > 0 && <CastList members={members} title={title} />
}

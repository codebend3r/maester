import { type PersonDetails, type PersonProfile, ageOn } from '@raven/core'
import { Button, ButtonLink } from '@raven/ui'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { api } from '@/lib/api'
import { PERSON_COPY } from '@/pages/PersonPage/copy'
import styles from '@/pages/PersonPage/PersonPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** The first letters of a name's first two words, for a person with no photo: "Rebecca Ferguson" is RF. */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join('')

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' })

/** A `YYYY-MM-DD` day as the reader writes it, "November 21, 2000"; null for anything else. */
const formatDay = (day: string): string | null => {
  const match = DAY.exec(day)
  if (!match) return null
  // Built and read in UTC, so no time zone moves it to the day before.
  return longDate.format(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

const twoDigits = (n: number): string => String(n).padStart(2, '0')

/** Today where the reader is, `YYYY-MM-DD`, the day an age is counted to. */
const todayHere = (): string => {
  const now = new Date()
  return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`
}

type LifeLineProps = {
  profile: PersonProfile | null
  today: string
}

/**
 * When and where they were born, then their age now or the day they died
 * and their age then: "Born November 21, 2000 in Santa Monica, California,
 * USA · 25 years old". A part TMDB leaves out is left out; null with no
 * birthday.
 */
export const lifeLine = ({ profile, today }: LifeLineProps): string | null => {
  const birthday = profile?.birthday ?? null
  const born = birthday == null ? null : formatDay(birthday)
  if (profile == null || born == null) return null
  const place = profile.placeOfBirth ? PERSON_COPY.bornIn(profile.placeOfBirth) : ''
  const birth = `${PERSON_COPY.born(born)}${place}`
  const age = ageOn({ birthday, on: profile.deathday ?? today })
  if (profile.deathday == null) {
    return age == null ? birth : `${birth}${COMMON_COPY.separator}${PERSON_COPY.yearsOld(age)}`
  }
  const died = formatDay(profile.deathday)
  if (died == null) return birth
  const death = age == null ? PERSON_COPY.died(died) : PERSON_COPY.diedAged({ day: died, age })
  return `${birth}${COMMON_COPY.separator}${death}`
}

/** A pixel the clamp can leave between the two heights with nothing hidden, as each rounds on its own. */
const ROUNDING_PX = 1

type BiographyProps = { text: string }

/**
 * Their biography, four lines of it, with More to read the rest when four
 * hide any. That hangs on the width the page leaves it, so it is measured
 * once laid out and again as the width changes.
 */
const Biography = ({ text }: BiographyProps) => {
  const id = useId()
  const paragraph = useRef<HTMLParagraphElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isClipped, setIsClipped] = useState(false)
  useLayoutEffect(() => {
    const element = paragraph.current
    // Open, nothing overflows, so measuring would take Less away.
    if (!element || isExpanded) return undefined
    const measure = () => setIsClipped(element.scrollHeight - element.clientHeight > ROUNDING_PX)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [isExpanded])
  return (
    <div className={styles.bio}>
      <p
        id={id}
        ref={paragraph}
        className={isExpanded ? styles.biography : `${styles.biography} ${styles.clamped}`}
      >
        {text}
      </p>
      {isClipped && (
        <Button
          tone="ghost"
          className={styles.more}
          aria-expanded={isExpanded}
          aria-controls={id}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? PERSON_COPY.less : PERSON_COPY.more}
        </Button>
      )}
    </div>
  )
}

/** Whether a person shows their photo or, with none, their initials. */
const PHOTO_KEYS = { photo: 'photo', initials: 'initials' } as const

type PhotoProps = { src: string }

const Photo = ({ src }: PhotoProps) => <img src={src} alt="" decoding="async" />

type InitialsProps = { name: string }

const Initials = ({ name }: InitialsProps) => <span aria-hidden="true">{initialsOf(name)}</span>

type PortraitProps = {
  [PHOTO_KEYS.photo]: PhotoProps
  [PHOTO_KEYS.initials]: InitialsProps
}

const PORTRAITS = {
  [PHOTO_KEYS.photo]: Photo,
  [PHOTO_KEYS.initials]: Initials,
} as const satisfies ViewsOf<PortraitProps>

type PortraitOfProps = { photo: string | null; name: string }

const portraitOf = ({ photo, name }: PortraitOfProps): ViewOf<PortraitProps> => {
  if (photo) return { key: PHOTO_KEYS.photo, props: { src: photo } }
  return { key: PHOTO_KEYS.initials, props: { name } }
}

type PersonHeaderProps = {
  person: PersonDetails
  headingId: string
  eyebrow: string | null
}

/**
 * Who they are: the way back, their photo or initials, the eyebrow over
 * their name, when and where they were born, their biography, and where
 * IMDb and TMDB keep them.
 */
export const PersonHeader = ({ person, headingId, eyebrow }: PersonHeaderProps) => {
  const photo = api.photoUrl({ personId: person.id, photoVersion: person.photoVersion })
  const { profile } = person
  const life = lifeLine({ profile, today: todayHere() })
  return (
    <header className={styles.header}>
      <BackButton fallback={HOME} className={styles.back} />
      <span className={photo ? styles.photo : `${styles.photo} ${styles.initials}`}>
        <KeyedView<PortraitProps>
          views={PORTRAITS}
          view={portraitOf({ photo, name: person.name })}
        />
      </span>
      <div className={styles.about}>
        <hgroup className={styles.named}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h1 id={headingId} className={styles.name}>
            {person.name}
          </h1>
        </hgroup>
        {life && <p className={styles.life}>{life}</p>}
        {profile?.biography && (
          // Keyed by its text, so a biography TMDB rewrites is measured afresh.
          <Biography key={profile.biography} text={profile.biography} />
        )}
        <ul className={styles.links}>
          {profile?.imdbId && (
            <li>
              <ButtonLink
                to={`https://www.imdb.com/name/${profile.imdbId}/`}
                target="_blank"
                rel="noreferrer"
              >
                {COMMON_COPY.imdb}
              </ButtonLink>
            </li>
          )}
          <li>
            <ButtonLink
              to={`https://www.themoviedb.org/person/${person.tmdbId}`}
              target="_blank"
              rel="noreferrer"
            >
              {COMMON_COPY.tmdb}
            </ButtonLink>
          </li>
        </ul>
      </div>
    </header>
  )
}

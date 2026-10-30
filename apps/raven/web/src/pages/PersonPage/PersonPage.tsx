import { useQuery } from '@tanstack/react-query'
import {
  CREDIT_JOBS,
  type CreditJob,
  FILMOGRAPHY_STATES,
  type FilmographyEntry,
  type ItemSummary,
  type PersonDetails,
  ROUTE_STATES,
  type RouteQuery,
  itemPath,
  routeState,
} from '@raven/core'
import { type ReactNode, useId } from 'react'
import { Link } from 'react-router-dom'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { RouteState } from '@/components/RouteState/RouteState'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { Bone } from '@/components/Skeleton/Skeleton'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import { personQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { PERSON_COPY } from '@/pages/PersonPage/copy'
import { Filmography, FilmographySkeleton, heldOnOpening } from '@/pages/PersonPage/Filmography'
import { FilmographyBones } from '@/pages/PersonPage/FilmographyTable'
import { PersonHeader } from '@/pages/PersonPage/PersonHeader'
import styles from '@/pages/PersonPage/PersonPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** The groups a person's credits fall into, in page order. */
const GROUPS: ReadonlyArray<{ title: string; jobs: readonly CreditJob[] }> = [
  { title: PERSON_COPY.groups.acting, jobs: [CREDIT_JOBS.cast, CREDIT_JOBS.guest] },
  { title: PERSON_COPY.groups.directing, jobs: [CREDIT_JOBS.director] },
  { title: PERSON_COPY.groups.writing, jobs: [CREDIT_JOBS.writer, CREDIT_JOBS.creator] },
  { title: PERSON_COPY.groups.producing, jobs: [CREDIT_JOBS.producer] },
]

type Credit = PersonDetails['credits'][number]

type CreditGroup = { title: string; credits: Credit[] }

/** Credits by group, each item once per group, newest first as the server lists them. */
export const groupCredits = (credits: readonly Credit[]): CreditGroup[] =>
  GROUPS.map((group) => ({
    title: group.title,
    credits: credits
      .filter((credit) => group.jobs.includes(credit.job))
      .filter((credit, index, all) => all.findIndex((c) => c.item.id === credit.item.id) === index),
  })).filter((group) => group.credits.length > 0)

type EyebrowOfProps = {
  person: PersonDetails
  groups: readonly CreditGroup[]
}

/**
 * The line over their name: what they are known for and how many of their
 * titles raven holds, once TMDB's filmography is in, counted as the table
 * opens so it matches the On raven marks; until then, how many credits
 * raven's own titles give them.
 */
const eyebrowOf = ({ person, groups }: EyebrowOfProps): string | null => {
  if (person.filmography.state === FILMOGRAPHY_STATES.ready) {
    const held = heldOnOpening(person.filmography.entries)
    const parts = [
      person.profile?.knownFor ?? null,
      held > 0 ? PERSON_COPY.titlesOnRaven(held) : null,
    ].filter((part): part is string => part != null)
    return parts.length > 0 ? parts.join(COMMON_COPY.separator) : null
  }
  const credits = groups.reduce((sum, group) => sum + group.credits.length, 0)
  return credits > 0 ? PERSON_COPY.inYourLibraries(credits) : null
}

/** Whether a card shows its poster or, with none, its title's initial. */
const CARD_PICTURE_KEYS = { poster: 'poster', initial: 'initial' } as const

type CardPosterProps = { poster: NonNullable<ReturnType<typeof posterSources>> }

const CardPoster = ({ poster }: CardPosterProps) => (
  <img {...poster} alt="" loading="lazy" decoding="async" />
)

type CardInitialProps = { title: string }

const CardInitial = ({ title }: CardInitialProps) => (
  <span aria-hidden="true">{title.slice(0, 1)}</span>
)

type CardPictureProps = {
  [CARD_PICTURE_KEYS.poster]: CardPosterProps
  [CARD_PICTURE_KEYS.initial]: CardInitialProps
}

const CARD_PICTURES = {
  [CARD_PICTURE_KEYS.poster]: CardPoster,
  [CARD_PICTURE_KEYS.initial]: CardInitial,
} as const satisfies ViewsOf<CardPictureProps>

/** The card's picture: its poster where it has one, else its title's initial. */
const cardPicture = (item: ItemSummary): ViewOf<CardPictureProps> => {
  const poster = posterSources({ item, sizes: POSTER_SIZES.grid })
  if (poster) return { key: CARD_PICTURE_KEYS.poster, props: { poster } }
  return { key: CARD_PICTURE_KEYS.initial, props: { title: item.title } }
}

type CardProps = { item: ItemSummary; role: string | null }

/** One title they are credited on: its poster, its name, and the year and their part under it. */
const Card = ({ item, role }: CardProps) => (
  <li className={styles.card}>
    <Link to={itemPath(item) ?? '/'} className={styles.link}>
      <span className={styles.poster}>
        <KeyedView<CardPictureProps> views={CARD_PICTURES} view={cardPicture(item)} />
      </span>
      <span className={styles.words}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.facts}>
          {item.year != null && <span>{item.year}</span>}
          {role && <span>{role}</span>}
        </span>
      </span>
    </Link>
  </li>
)

type HeldCreditsProps = { person: PersonDetails; groups: CreditGroup[] }

/** What raven holds of theirs, grouped by job as poster cards, for when TMDB has no filmography to give. */
const HeldCredits = ({ person, groups }: HeldCreditsProps) => {
  const id = useId()
  return (
    <>
      <p className={styles.message}>{PERSON_COPY.tmdbUnreachable}</p>
      {groups.map((group) => (
        <section
          key={group.title}
          className={styles.group}
          aria-labelledby={`${id}-${group.title}`}
        >
          <SectionHeading
            id={`${id}-${group.title}`}
            aside={PERSON_COPY.titles(group.credits.length)}
          >
            {group.title}
          </SectionHeading>
          <ul className={styles.grid}>
            {group.credits.map((credit) => (
              <Card key={`${credit.item.id}-${credit.job}`} item={credit.item} role={credit.role} />
            ))}
          </ul>
        </section>
      ))}
      {person.credits.length === 0 && (
        <p className={styles.message}>{PERSON_COPY.nothingCredits(person.name)}</p>
      )}
    </>
  )
}

type FilmographySectionProps = { children: ReactNode }

/** Their filmography under its heading. */
const FilmographySection = ({ children }: FilmographySectionProps) => {
  const id = useId()
  return (
    <section className={styles.filmography} aria-labelledby={id}>
      <SectionHeading id={id}>{PERSON_COPY.filmography}</SectionHeading>
      {children}
    </section>
  )
}

type ReadyFilmographyProps = { name: string; entries: readonly FilmographyEntry[] }

const ReadyFilmography = ({ name, entries }: ReadyFilmographyProps) => (
  <FilmographySection>
    <Filmography name={name} entries={entries} />
  </FilmographySection>
)

type PendingFilmographyProps = { name: string }

const PendingFilmography = ({ name }: PendingFilmographyProps) => (
  <FilmographySection>
    <FilmographySkeleton name={name} />
  </FilmographySection>
)

type PersonCreditsViewProps = {
  [FILMOGRAPHY_STATES.ready]: ReadyFilmographyProps
  [FILMOGRAPHY_STATES.pending]: PendingFilmographyProps
  [FILMOGRAPHY_STATES.unavailable]: HeldCreditsProps
}

const PERSON_CREDITS_VIEWS = {
  [FILMOGRAPHY_STATES.ready]: ReadyFilmography,
  [FILMOGRAPHY_STATES.pending]: PendingFilmography,
  [FILMOGRAPHY_STATES.unavailable]: HeldCredits,
} as const satisfies ViewsOf<PersonCreditsViewProps>

type PersonCreditsProps = { person: PersonDetails; groups: CreditGroup[] }

/** Their filmography: in, on its way, or what raven holds when TMDB has none. */
type PersonCreditsViewOfProps = PersonCreditsProps

const personCreditsViewOf = ({
  person,
  groups,
}: PersonCreditsViewOfProps): ViewOf<PersonCreditsViewProps> => {
  const { filmography } = person
  switch (filmography.state) {
    case FILMOGRAPHY_STATES.ready:
      return {
        key: FILMOGRAPHY_STATES.ready,
        props: { name: person.name, entries: filmography.entries },
      }
    case FILMOGRAPHY_STATES.pending:
      return { key: FILMOGRAPHY_STATES.pending, props: { name: person.name } }
    case FILMOGRAPHY_STATES.unavailable:
      return { key: FILMOGRAPHY_STATES.unavailable, props: { person, groups } }
    default: {
      const unknown: never = filmography
      return unknown
    }
  }
}

/** A person on their way: their photo's place and lines for the eyebrow and name, over rows of titles. */
const PersonSkeleton = () => (
  <>
    <div className={styles.header}>
      <span className={styles.back}>
        <Bone shape="button" />
      </span>
      <span className={styles.photo}>
        <Bone shape="fill" />
      </span>
      <span className={styles.about}>
        <Bone shape="small" width="half" />
        <Bone shape="hero" width="most" />
        <Bone shape="text" width="half" />
      </span>
    </div>
    <FilmographyBones />
  </>
)

type PersonViewProps = { person: PersonDetails }

const PersonView = ({ person }: PersonViewProps) => {
  const id = useId()
  const groups = groupCredits(person.credits)
  return (
    <article className={styles.page} aria-labelledby={id}>
      <PersonHeader person={person} headingId={id} eyebrow={eyebrowOf({ person, groups })} />
      <KeyedView<PersonCreditsViewProps>
        views={PERSON_CREDITS_VIEWS}
        view={personCreditsViewOf({ person, groups })}
      />
      <TmdbCredit />
    </article>
  )
}

type KeyedPersonViewProps = PersonViewProps

// Keyed, so another person's page opens with their own toggle, sort and biography.
const KeyedPersonView = ({ person }: KeyedPersonViewProps) => (
  <PersonView key={person.id} person={person} />
)

const PERSON_VIEW_KEYS = { pending: 'pending', ready: 'ready' } as const

type PersonPageViewProps = {
  [PERSON_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [PERSON_VIEW_KEYS.ready]: PersonViewProps
}

const PERSON_VIEWS = {
  [PERSON_VIEW_KEYS.pending]: RouteState,
  [PERSON_VIEW_KEYS.ready]: KeyedPersonView,
} as const satisfies ViewsOf<PersonPageViewProps>

/** The person on their way or failing, or their page. */
const personView = (page: RouteQuery<PersonDetails>): ViewOf<PersonPageViewProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: PERSON_VIEW_KEYS.pending,
      props: { state: page, noun: PERSON_COPY.noun, shape: <PersonSkeleton /> },
    }
  return { key: PERSON_VIEW_KEYS.ready, props: { person: page.data } }
}

/**
 * `/people/:id`: who a person is, then everything TMDB credits them on with
 * raven's titles marked, asked for again while that is on its way.
 */
export const PersonPage = () => {
  const id = useRouteId()
  const page = routeState({ id, query: useQuery(personQuery(id)) })
  return <KeyedView<PersonPageViewProps> views={PERSON_VIEWS} view={personView(page)} />
}

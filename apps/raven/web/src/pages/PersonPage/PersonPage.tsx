import { useQuery } from '@tanstack/react-query'
import { type CreditJob, type ItemSummary, type PersonDetails, plural } from '@raven/core'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { RouteState } from '@/components/RouteState/RouteState'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { Bone } from '@/components/Skeleton/Skeleton'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { itemPath } from '@/lib/itemLinks'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import { personQuery } from '@/lib/queries'
import { ROUTE_STATES, routeState, useRouteId } from '@/lib/routeQuery'
import { Filmography, FilmographySkeleton, heldOnOpening } from '@/pages/PersonPage/Filmography'
import { FilmographyBones } from '@/pages/PersonPage/FilmographyTable'
import { PersonHeader } from '@/pages/PersonPage/PersonHeader'
import styles from '@/pages/PersonPage/PersonPage.module.scss'

/** The groups a person's credits fall into, in page order. */
const GROUPS: ReadonlyArray<{ title: string; jobs: readonly CreditJob[] }> = [
  { title: 'Acting', jobs: ['cast', 'guest'] },
  { title: 'Directing', jobs: ['director'] },
  { title: 'Writing', jobs: ['writer', 'creator'] },
  { title: 'Producing', jobs: ['producer'] },
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

/**
 * The line over their name: what they are known for and how many of their
 * titles raven holds, once TMDB's filmography is in, counted as the table
 * opens so it matches the On raven marks; until then, how many credits
 * raven's own titles give them.
 */
const eyebrowOf = ({
  person,
  groups,
}: {
  person: PersonDetails
  groups: readonly CreditGroup[]
}): string | null => {
  if (person.filmography.state === 'ready') {
    const held = heldOnOpening(person.filmography.entries)
    const parts = [
      person.profile?.knownFor ?? null,
      held > 0 ? `${plural({ n: held, one: 'title', many: 'titles' })} on raven` : null,
    ].filter((part): part is string => part != null)
    return parts.length > 0 ? parts.join(' · ') : null
  }
  const credits = groups.reduce((sum, group) => sum + group.credits.length, 0)
  return credits > 0
    ? `In your libraries · ${plural({ n: credits, one: 'credit', many: 'credits' })}`
    : null
}

/** One title they are credited on: its poster, its name, and the year and their part under it. */
const Card = ({ item, role }: { item: ItemSummary; role: string | null }) => {
  const poster = posterSources({ item, sizes: POSTER_SIZES.grid })
  return (
    <li className={styles.card}>
      <Link to={itemPath(item) ?? '/'} className={styles.link}>
        <span className={styles.poster}>
          {poster ? (
            <img {...poster} alt="" loading="lazy" decoding="async" />
          ) : (
            <span aria-hidden="true">{item.title.slice(0, 1)}</span>
          )}
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
}

/** What raven holds of theirs, grouped by job as poster cards, for when TMDB has no filmography to give. */
const HeldCredits = ({ person, groups }: { person: PersonDetails; groups: CreditGroup[] }) => {
  const id = useId()
  return (
    <>
      <p className={styles.message}>
        TMDB could not be reached, so this lists only what raven holds.
      </p>
      {groups.map((group) => (
        <section
          key={group.title}
          className={styles.group}
          aria-labelledby={`${id}-${group.title}`}
        >
          <SectionHeading
            id={`${id}-${group.title}`}
            aside={plural({ n: group.credits.length, one: 'title', many: 'titles' })}
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
        <p className={styles.message}>Nothing in raven credits {person.name} yet.</p>
      )}
    </>
  )
}

/** Their filmography under its heading: in, on its way, or what raven holds when TMDB has none. */
const PersonCredits = ({ person, groups }: { person: PersonDetails; groups: CreditGroup[] }) => {
  const id = useId()
  const { filmography } = person
  switch (filmography.state) {
    case 'ready':
    case 'pending':
      return (
        <section className={styles.filmography} aria-labelledby={id}>
          <SectionHeading id={id}>Filmography</SectionHeading>
          {filmography.state === 'ready' ? (
            <Filmography name={person.name} entries={filmography.entries} />
          ) : (
            <FilmographySkeleton name={person.name} />
          )}
        </section>
      )
    case 'unavailable':
      return <HeldCredits person={person} groups={groups} />
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

const PersonView = ({ person }: { person: PersonDetails }) => {
  const id = useId()
  const groups = groupCredits(person.credits)
  return (
    <article className={styles.page} aria-labelledby={id}>
      <PersonHeader person={person} headingId={id} eyebrow={eyebrowOf({ person, groups })} />
      <PersonCredits person={person} groups={groups} />
      <TmdbCredit />
    </article>
  )
}

/**
 * `/people/:id`: who a person is, then everything TMDB credits them on with
 * raven's titles marked, asked for again while that is on its way.
 */
export const PersonPage = () => {
  const id = useRouteId()
  const page = routeState({ id, query: useQuery(personQuery(id)) })
  if (page.state !== ROUTE_STATES.ready)
    return <RouteState state={page} noun="page" shape={<PersonSkeleton />} />
  // Keyed, so another person's page opens with their own toggle, sort and biography.
  return <PersonView key={page.data.id} person={page.data} />
}

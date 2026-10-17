import { useQuery } from '@tanstack/react-query'
import type { CreditJob, ItemSummary, PersonDetails } from '@raven/core'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { RouteState } from '@/components/RouteState/RouteState'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { Bone, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { api } from '@/lib/api'
import { itemPath } from '@/lib/itemLinks'
import { plural } from '@/lib/plural'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import { personQuery } from '@/lib/queries'
import { routeState, useRouteId } from '@/lib/routeQuery'
import styles from '@/pages/PersonPage/PersonPage.module.scss'

/** The groups a person's credits fall into, in page order. */
const GROUPS: ReadonlyArray<{ title: string; jobs: readonly CreditJob[] }> = [
  { title: 'Acting', jobs: ['cast', 'guest'] },
  { title: 'Directing', jobs: ['director'] },
  { title: 'Writing', jobs: ['writer', 'creator'] },
  { title: 'Producing', jobs: ['producer'] },
]

type Credit = PersonDetails['credits'][number]

/** Credits by group, each item once per group, newest first as the server lists them. */
export const groupCredits = (
  credits: readonly Credit[],
): Array<{ title: string; credits: Credit[] }> =>
  GROUPS.map((group) => ({
    title: group.title,
    credits: credits
      .filter((credit) => group.jobs.includes(credit.job))
      .filter((credit, index, all) => all.findIndex((c) => c.item.id === credit.item.id) === index),
  })).filter((group) => group.credits.length > 0)

/** The first letters of a name's first two words, for a person with no photo: "Rebecca Ferguson" is RF. */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join('')

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

/** A person on their way: their photo's place and lines for the eyebrow and name, over a grid of posters. */
const PersonSkeleton = () => (
  <>
    <div className={styles.header}>
      <span className={styles.photo}>
        <Bone shape="fill" />
      </span>
      <span className={styles.named}>
        <Bone shape="small" width="half" />
        <Bone shape="hero" width="most" />
      </span>
    </div>
    <ul className={styles.grid}>
      <SkeletonCards picture="poster" count={6} />
    </ul>
  </>
)

const PersonView = ({ person }: { person: PersonDetails }) => {
  const id = useId()
  const photo = api.photoUrl({ personId: person.id, photoVersion: person.photoVersion })
  const groups = groupCredits(person.credits)
  const credits = groups.reduce((sum, group) => sum + group.credits.length, 0)
  return (
    <article className={styles.page} aria-labelledby={id}>
      <header className={styles.header}>
        <span className={photo ? styles.photo : `${styles.photo} ${styles.initials}`}>
          {photo ? (
            <img src={photo} alt="" decoding="async" />
          ) : (
            <span aria-hidden="true">{initialsOf(person.name)}</span>
          )}
        </span>
        <span className={styles.named}>
          {credits > 0 && (
            <span className={styles.eyebrow}>
              In your libraries · {plural({ n: credits, one: 'credit', many: 'credits' })}
            </span>
          )}
          <h1 id={id} className={styles.name}>
            {person.name}
          </h1>
        </span>
      </header>
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
      <TmdbCredit />
    </article>
  )
}

/** `/people/:id`: a person's photo and name, and everything in raven they are credited on. */
export const PersonPage = () => {
  const id = useRouteId()
  const page = routeState({ id, query: useQuery(personQuery(id)) })
  if (page.state !== 'ready')
    return <RouteState state={page} noun="page" shape={<PersonSkeleton />} />
  return <PersonView person={page.data} />
}

import { useQuery } from '@tanstack/react-query'
import { ApiError, type CreditJob, type ItemSummary, type PersonDetails } from '@raven/core'
import { useId } from 'react'
import { Link, useParams } from 'react-router-dom'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { api } from '@/lib/api'
import { itemPath } from '@/lib/itemLinks'
import { queryKeys } from '@/lib/queryClient'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
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

const Card = ({ item, role }: { item: ItemSummary; role: string | null }) => {
  const poster = api.itemImageUrl({ id: item.id, kind: 'poster', version: item.posterVersion })
  return (
    <li className={styles.card}>
      <Link to={itemPath(item) ?? '/'} className={styles.link}>
        <span className={styles.poster}>
          {poster ? (
            <img src={poster} alt="" loading="lazy" decoding="async" />
          ) : (
            <span aria-hidden="true">{item.title.slice(0, 1)}</span>
          )}
        </span>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.facts}>
          {item.year != null && <span>{item.year}</span>}
          {role && <span>{role}</span>}
        </span>
      </Link>
    </li>
  )
}

const PersonView = ({ person }: { person: PersonDetails }) => {
  const id = useId()
  const photo = api.photoUrl({ personId: person.id, photoVersion: person.photoVersion })
  return (
    <article className={styles.page} aria-labelledby={id}>
      <header className={styles.header}>
        <span className={styles.photo}>
          {photo ? (
            <img src={photo} alt="" decoding="async" />
          ) : (
            <span aria-hidden="true">{person.name.slice(0, 1)}</span>
          )}
        </span>
        <h1 id={id} className={styles.name}>
          {person.name}
        </h1>
      </header>
      {groupCredits(person.credits).map((group) => (
        <section
          key={group.title}
          className={styles.group}
          aria-labelledby={`${id}-${group.title}`}
        >
          <h2 id={`${id}-${group.title}`} className={styles.heading}>
            {group.title}
          </h2>
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
  const params = useParams()
  const id = Number(params.id)
  const person = useQuery({
    queryKey: queryKeys.person(id),
    queryFn: () => api.getPerson(id),
    enabled: Number.isInteger(id),
  })
  const missing = person.error instanceof ApiError && person.error.status === 404
  if (!Number.isInteger(id) || missing) return <NotFoundPage />
  if (person.isError) {
    return (
      <p className={styles.message} role="alert">
        {person.error.message}
      </p>
    )
  }
  if (!person.data) return <p className={styles.message}>Opening the page</p>
  return <PersonView person={person.data} />
}

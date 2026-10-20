import { CREDIT_JOBS, type Credit, type CreditJob } from '@/contract'

/** A person once, with every role they have on this item. */
export type CastMember = {
  personId: number
  name: string
  roles: string[]
  photoVersion: string | null
}

const JOB_NAMES = {
  [CREDIT_JOBS.cast]: 'Actor',
  [CREDIT_JOBS.guest]: 'Guest star',
  [CREDIT_JOBS.director]: 'Director',
  [CREDIT_JOBS.writer]: 'Writer',
  [CREDIT_JOBS.creator]: 'Creator',
  [CREDIT_JOBS.producer]: 'Producer',
} as const satisfies Record<CreditJob, string>

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

/** What stands in for a person's photo: the first letters of the first two words of their name. */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1))
    .slice(0, 2)
    .join('')

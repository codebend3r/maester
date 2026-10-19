import {
  type FilmographyEntry,
  entriesOn,
  hasSelfCredits,
  isFilmographyTab,
  tabCounts,
} from '@raven/core'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loading } from '@/components/Skeleton/Skeleton'
import { useAddressSearch } from '@/lib/useSearch'
import { FilmographyBones, FilmographyTable, rolesOf } from '@/pages/PersonPage/FilmographyTable'
import { FilmographyToolbar } from '@/pages/PersonPage/FilmographyToolbar'
import styles from '@/pages/PersonPage/PersonPage.module.scss'

/** Text as a search compares it: no case, and no accents, so "amelie" finds Amélie. */
const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()

/** Whether a title, or a part they play in it the tab shows, holds `query`, already folded. */
const matches = ({ entry, query }: { entry: FilmographyEntry; query: string }): boolean =>
  query === '' || fold(`${entry.title}\n${rolesOf(entry)}`).includes(query)

const noTitles = (name: string): string => `TMDB lists no titles for ${name}.`

/** What shows in place of a table with no rows, or null while it has some. */
const emptyMessage = ({
  rows,
  query,
  name,
}: {
  rows: number
  query: string
  name: string
}): string | null => {
  if (rows > 0) return null
  if (query) return `No titles match "${query}".`
  return noTitles(name)
}

/**
 * Whether every credit is an appearance as themselves. Hiding those would
 * leave nothing, so then they show from the start and the toggle goes.
 */
const isOnlySelf = (entries: readonly FilmographyEntry[]): boolean =>
  tabCounts({ entries, isSelfShown: false }).all === 0

/**
 * How many titles raven holds of those the table lists as it opens, on All
 * with appearances as themselves hidden, so the count over their name
 * matches the On raven marks under it.
 */
export const heldOnOpening = (entries: readonly FilmographyEntry[]): number =>
  entriesOn({ entries, tab: 'all', isSelfShown: isOnlySelf(entries) }).filter(
    (entry) => entry.item != null,
  ).length

/** A person's whole filmography on its way: rows of stand-ins, which a screen reader hears as `name`'s. */
export const FilmographySkeleton = ({ name }: { name: string }) => (
  <Loading label={`Fetching ${name}'s filmography`}>
    <FilmographyBones />
  </Loading>
)

/**
 * A person's whole filmography as TMDB lists it, raven's titles marked:
 * the search, the toggle and the tabs over the table. The tab rides in the
 * address as `?credits=`, and one with nothing on it is All.
 */
export const Filmography = ({
  name,
  entries,
}: {
  name: string
  entries: readonly FilmographyEntry[]
}) => {
  const search = useAddressSearch()
  const [address] = useSearchParams()
  const [isSelfAsked, setIsSelfAsked] = useState(false)
  const hasOnlySelf = useMemo(() => isOnlySelf(entries), [entries])
  const isSelfShown = isSelfAsked || hasOnlySelf
  const counts = useMemo(() => tabCounts({ entries, isSelfShown }), [entries, isSelfShown])
  const asked = address.get('credits')
  const tab = isFilmographyTab(asked) && counts[asked] > 0 ? asked : 'all'
  // Each keystroke draws the page again, but the rows, and so the table,
  // change only once the query the search settles on does.
  const query = search.query
  const rows = useMemo(() => {
    const folded = fold(query)
    return entriesOn({ entries, tab, isSelfShown }).filter((entry) =>
      matches({ entry, query: folded }),
    )
  }, [entries, tab, isSelfShown, query])
  if (entries.length === 0) return <p className={styles.message}>{noTitles(name)}</p>
  const message = emptyMessage({ rows: rows.length, query, name })
  return (
    <>
      <FilmographyToolbar
        search={search}
        tab={tab}
        counts={counts}
        hasSelfCredits={hasSelfCredits(entries) && !hasOnlySelf}
        isSelfShown={isSelfShown}
        onSelfShownChange={setIsSelfAsked}
      />
      <FilmographyTable entries={rows} tab={tab} isHidden={message != null} />
      {message != null && <p className={styles.message}>{message}</p>}
    </>
  )
}

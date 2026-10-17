import {
  type FilmographyEntry,
  entriesOn,
  hasSelfCredits,
  isFilmographyTab,
  tabCounts,
} from '@raven/core'
import { useState } from 'react'
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
  // Hiding appearances as themselves from someone who has nothing else would
  // leave an empty table, so then they show and the toggle goes.
  const isOnlySelf = tabCounts({ entries, isSelfShown: false }).all === 0
  const isSelfShown = isSelfAsked || isOnlySelf
  const counts = tabCounts({ entries, isSelfShown })
  const asked = address.get('credits')
  const tab = isFilmographyTab(asked) && counts[asked] > 0 ? asked : 'all'
  const query = fold(search.query)
  const rows = entriesOn({ entries, tab, isSelfShown }).filter((entry) => matches({ entry, query }))
  if (entries.length === 0) return <p className={styles.message}>{noTitles(name)}</p>
  const message = emptyMessage({ rows: rows.length, query: search.query, name })
  return (
    <>
      <FilmographyToolbar
        search={search}
        tab={tab}
        counts={counts}
        hasSelfCredits={hasSelfCredits(entries) && !isOnlySelf}
        isSelfShown={isSelfShown}
        onSelfShownChange={setIsSelfAsked}
      />
      {message == null ? (
        <FilmographyTable entries={rows} tab={tab} />
      ) : (
        <p className={styles.message}>{message}</p>
      )}
    </>
  )
}

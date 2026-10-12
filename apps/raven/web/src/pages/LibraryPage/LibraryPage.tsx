import { useQuery } from '@tanstack/react-query'
import type { Library, MediaItem } from '@raven/core'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ButtonLink } from '@/components/Button/Button'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { LibraryToolbar } from '@/components/LibraryToolbar/LibraryToolbar'
import { LockedLibrary } from '@/components/LockedLibrary/LockedLibrary'
import { RouteState } from '@/components/RouteState/RouteState'
import { watchLink } from '@/lib/itemLinks'
import { libraryQuery, lockQuery } from '@/lib/queries'
import { routeState, useRouteId } from '@/lib/routeQuery'
import { LibraryHeader, useLibraryActions } from '@/pages/LibraryPage/LibraryHeader'
import { LibraryListing } from '@/pages/LibraryPage/LibraryViews'
import { playQueue } from '@/pages/LibraryPage/libraryShape'
import { useLibraryListing } from '@/pages/LibraryPage/useLibraryListing'
import { useLibraryView } from '@/pages/LibraryPage/useLibraryView'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** What the page says in place of a listing with nothing in it, or null while there is something. */
const emptyMessage = ({
  loaded,
  empty,
  query,
  scanning,
}: {
  loaded: boolean
  empty: boolean
  query: string
  scanning: boolean
}): string | null => {
  if (!loaded || !empty) return null
  if (query) return `Nothing here matches "${query}".`
  if (scanning) return 'Looking through the folders. Videos appear here as they are found.'
  return 'No videos in these folders yet. Check the paths, or add a folder that holds videos.'
}

/** The page once its library is known. */
const LibraryView = ({ library }: { library: Library }) => {
  const ids = { title: useId() }
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const view = useLibraryView({ library })
  const { settings } = view
  const scanning = library.scan.state === 'scanning'
  // A locked library's videos are not asked for until this browser has the PIN.
  const lock = useQuery({ ...lockQuery, enabled: settings.locked })
  const shut = settings.locked && !lock.data?.unlocked
  const actions = useLibraryActions(library)
  const listing = useLibraryListing({
    libraryId: library.id,
    settings,
    search: view.query,
    seed: view.seed,
    enabled: !shut,
    scanning,
  })
  const queue = playQueue({ settings, listing })
  const empty = emptyMessage({
    loaded: listing.loaded,
    empty: listing.shows.length === 0 && listing.files.length === 0,
    query: view.query,
    scanning,
  })

  // The item rides along in router state, as a card click hands it over, so
  // the player starts without fetching it again.
  const watch = (item: MediaItem | undefined) => {
    if (!item) return
    const link = watchLink(item)
    navigate(link.to, { state: link.state })
  }

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <ButtonLink to="/libraries" icon="back" className={styles.back}>
        Libraries
      </ButtonLink>

      <LibraryHeader
        titleId={ids.title}
        library={library}
        settings={settings}
        actions={actions}
        canMatch={listing.canMatch}
        shut={shut}
        onEdit={() => setEditing(true)}
      />

      {shut && lock.data && <LockedLibrary name={library.name} available={lock.data.available} />}

      {!shut && (
        <>
          <LibraryToolbar
            name={library.name}
            search={view.search}
            onSearch={view.setSearch}
            settings={settings}
            onChange={view.change}
            playable={queue.playable}
            onPlay={() => watch(queue.first())}
            onShuffle={() => watch(queue.random())}
          />

          {view.saveError && (
            <p className={styles.message} role="alert">
              Could not save how this library is shown: {view.saveError.message}
            </p>
          )}
          {actions.rematch.isError && (
            <p className={styles.message} role="alert">
              Could not match again: {actions.rematch.error.message}
            </p>
          )}

          {empty ? (
            <p className={styles.message}>{empty}</p>
          ) : (
            <LibraryListing
              settings={settings}
              shows={listing.shows}
              files={listing.files}
              listsShows={listing.listsShows}
              busy={listing.busy}
            />
          )}
        </>
      )}

      {editing && <LibraryDialog library={library} onClose={() => setEditing(false)} />}
    </section>
  )
}

/** `/libraries/:id`: a library's videos or shows, searched, sorted and laid out as it was left. */
export const LibraryPage = () => {
  const libraryId = useRouteId()
  const library = useQuery({
    ...libraryQuery(libraryId),
    refetchInterval: (current) => (current.state.data?.scan.state === 'scanning' ? 1500 : false),
  })
  const page = routeState({ id: libraryId, query: library })
  if (page.state !== 'ready') return <RouteState state={page} noun="library" />
  return <LibraryView library={page.data} />
}

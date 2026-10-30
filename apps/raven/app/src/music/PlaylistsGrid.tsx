import { LIBRARY_VIEWS, type Library, libraryIconOf, plural } from '@raven/core'
import { useServerPlaylistMutations } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'

import { Grid, NewPlaylistButton } from '@/layouts'
import { MUSIC_COPY } from '@/layouts/copy'
import { PLAYLISTS_GRID_COPY } from '@/music/copy'
import { playlistSectionsOf } from '@/music/musicCards'
import type { ShelfCard } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'
import { ROUTE_TARGETS, hrefOf } from '@/routes'

type PlaylistsGridProps = {
  session: AppQueries
  /** The music library the page was opened from, whose name and icon it keeps. */
  library: Library
  /** The ways to the library's other pages, in the toolbar. */
  toggle: ReactNode
}

/**
 * The account's playlists, one row each with its tracks and length, opening its page. They are
 * the account's, not the library's, so every music library lists the same ones. New playlist
 * names one and opens it.
 */
export const PlaylistsGrid = ({
  session: { api, queries },
  library,
  toggle,
}: PlaylistsGridProps) => {
  const router = useRouter()
  const playlists = useQuery(queries.playlistsQuery)
  const { create } = useServerPlaylistMutations({ api })
  const notice = ((): string | null => {
    if (playlists.error !== null && playlists.data === undefined) return playlists.error.message
    if (playlists.data === undefined) return PLAYLISTS_GRID_COPY.gathering
    return playlists.data.length > 0 ? null : PLAYLISTS_GRID_COPY.none
  })()
  const make = (name: string) =>
    create.mutate(name, {
      onSuccess: (details) =>
        router.push(hrefOf({ kind: ROUTE_TARGETS.playlist, playlistId: details.playlist.id })),
    })
  return (
    <Grid
      icon={libraryIconOf(library.settings)}
      jump={null}
      line={plural({ n: playlists.data?.length ?? 0, ...MUSIC_COPY.playlists })}
      notice={notice}
      onBack={() => router.back()}
      onOpen={({ target }: ShelfCard) => router.push(hrefOf(target))}
      search={null}
      sections={playlistSectionsOf(playlists.data ?? [])}
      title={library.name}
      toolbar={
        <>
          {toggle}
          <NewPlaylistButton onCreate={make} />
        </>
      }
      view={LIBRARY_VIEWS.list}
    />
  )
}

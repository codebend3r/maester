import type { Library } from '@raven/core'
import { type ComponentType, useState } from 'react'

import { MUSIC_PAGES_COPY } from '@/music/copy'
import { AlbumsGrid } from '@/music/AlbumsGrid'
import { ArtistsGrid } from '@/music/ArtistsGrid'
import { PlaylistsGrid } from '@/music/PlaylistsGrid'
import type { AppQueries } from '@/queries/useAppQueries'
import { type PageFrame, type PageTab } from '@/screens/PageTools'
import { APP_ICONS } from '@/theme/icons'

/**
 * The pages a music library opens on: its albums as covers, its artists by name, and the
 * account's playlists.
 */
const MUSIC_PAGES = { albums: 'albums', artists: 'artists', playlists: 'playlists' } as const

type MusicPage = (typeof MUSIC_PAGES)[keyof typeof MUSIC_PAGES]

/** The pages in the order the toolbar names them. */
const PAGE_ORDER: readonly MusicPage[] = [
  MUSIC_PAGES.albums,
  MUSIC_PAGES.artists,
  MUSIC_PAGES.playlists,
]

/** What each page's button says and draws. */
const PAGE_TABS = {
  [MUSIC_PAGES.albums]: { name: MUSIC_PAGES_COPY.albums, icon: APP_ICONS.disc },
  [MUSIC_PAGES.artists]: { name: MUSIC_PAGES_COPY.artists, icon: APP_ICONS.music },
  [MUSIC_PAGES.playlists]: { name: MUSIC_PAGES_COPY.playlists, icon: APP_ICONS.list },
} as const satisfies Record<MusicPage, PageTab>

type MusicPagesProps = { session: AppQueries; library: Library; asked: string }

/** What a music library's pages share: the page open, the pages, and the library the toolbar frames. */
export type MusicFrame = PageFrame<MusicPage>

type MusicPageViewProps = MusicPagesProps & { frame: MusicFrame }

/** Each page as the toolbar's choice draws it. */
const MUSIC_PAGE_VIEWS = {
  [MUSIC_PAGES.albums]: AlbumsGrid,
  [MUSIC_PAGES.artists]: ArtistsGrid,
  [MUSIC_PAGES.playlists]: PlaylistsGrid,
} as const satisfies Record<MusicPage, ComponentType<MusicPageViewProps>>

/**
 * A music library's three pages, its albums, its artists and the account's playlists, with a
 * press from each to the others. It opens on the albums, searched by what it was handed; the
 * choice lasts while the page is open.
 */
export const MusicPages = ({ session, library, asked }: MusicPagesProps) => {
  const [page, setPage] = useState<MusicPage>(MUSIC_PAGES.albums)
  const Page = MUSIC_PAGE_VIEWS[page]
  const frame: MusicFrame = {
    page,
    pages: PAGE_ORDER,
    tabs: PAGE_TABS,
    onChange: setPage,
    library,
    api: session.api,
  }
  return <Page asked={asked} frame={frame} library={library} session={session} />
}

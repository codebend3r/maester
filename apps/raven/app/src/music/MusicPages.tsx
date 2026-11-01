import type { Library } from '@raven/core'
import type { IconName } from '@raven/ui/iconDrawings'
import { type ComponentType, type ReactNode, useState } from 'react'

import { ToolButton } from '@/layouts'
import { MUSIC_PAGES_COPY } from '@/music/copy'
import { AlbumsGrid } from '@/music/AlbumsGrid'
import { ArtistsGrid } from '@/music/ArtistsGrid'
import { PlaylistsGrid } from '@/music/PlaylistsGrid'
import type { AppQueries } from '@/queries/useAppQueries'

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

/** What each page is called, on the button that leads to it. */
const PAGE_NAMES = {
  [MUSIC_PAGES.albums]: MUSIC_PAGES_COPY.albums,
  [MUSIC_PAGES.artists]: MUSIC_PAGES_COPY.artists,
  [MUSIC_PAGES.playlists]: MUSIC_PAGES_COPY.playlists,
} as const satisfies Record<MusicPage, string>

type MusicPageToggleProps = { page: MusicPage; onChange: (page: MusicPage) => void }

/** What each page's button draws beside its name. */
const PAGE_ICONS = {
  [MUSIC_PAGES.albums]: 'disc',
  [MUSIC_PAGES.artists]: 'music',
  [MUSIC_PAGES.playlists]: 'list',
} as const satisfies Record<MusicPage, IconName>

/** One press from any page to each of the others: each named for where it goes. */
const MusicPageToggle = ({ page, onChange }: MusicPageToggleProps) =>
  PAGE_ORDER.filter((other) => other !== page).map((other) => (
    <ToolButton
      key={other}
      accessibilityLabel={MUSIC_PAGES_COPY.show(PAGE_NAMES[other])}
      icon={PAGE_ICONS[other]}
      label={PAGE_NAMES[other]}
      onPress={() => onChange(other)}
    />
  ))

type MusicPagesProps = { session: AppQueries; library: Library; asked: string }

type MusicPageViewProps = MusicPagesProps & { toggle: ReactNode }

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
  return (
    <Page
      asked={asked}
      library={library}
      session={session}
      toggle={<MusicPageToggle onChange={setPage} page={page} />}
    />
  )
}

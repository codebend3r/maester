import type { Library } from '@raven/core'
import { useState } from 'react'

import { ToolButton } from '@/layouts'
import { AlbumsGrid } from '@/music/AlbumsGrid'
import { ArtistsGrid } from '@/music/ArtistsGrid'
import { PlaylistsGrid } from '@/music/PlaylistsGrid'
import type { AppQueries } from '@/queries/useAppQueries'

const COPY = { show: (page: string) => `Show ${page}` } as const

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
  [MUSIC_PAGES.albums]: 'Albums',
  [MUSIC_PAGES.artists]: 'Artists',
  [MUSIC_PAGES.playlists]: 'Playlists',
} as const satisfies Record<MusicPage, string>

type MusicPageToggleProps = { page: MusicPage; onChange: (page: MusicPage) => void }

/** One press from any page to each of the others: each named for where it goes. */
const MusicPageToggle = ({ page, onChange }: MusicPageToggleProps) =>
  PAGE_ORDER.filter((other) => other !== page).map((other) => (
    <ToolButton
      key={other}
      accessibilityLabel={COPY.show(PAGE_NAMES[other])}
      label={PAGE_NAMES[other]}
      onPress={() => onChange(other)}
    />
  ))

type MusicPagesProps = { session: AppQueries; library: Library; asked: string }

/**
 * A music library's three pages, its albums, its artists and the account's playlists, with a
 * press from each to the others. It opens on the albums, searched by what it was handed; the
 * choice lasts while the page is open.
 */
export const MusicPages = ({ session, library, asked }: MusicPagesProps) => {
  const [page, setPage] = useState<MusicPage>(MUSIC_PAGES.albums)
  const toggle = <MusicPageToggle onChange={setPage} page={page} />
  switch (page) {
    case MUSIC_PAGES.albums:
      return <AlbumsGrid asked={asked} library={library} session={session} toggle={toggle} />
    case MUSIC_PAGES.artists:
      return <ArtistsGrid library={library} session={session} toggle={toggle} />
    case MUSIC_PAGES.playlists:
      return <PlaylistsGrid library={library} session={session} toggle={toggle} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

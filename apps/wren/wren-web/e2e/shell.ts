import { expect, type Locator, type Page } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { HOME_COPY, KIT_COPY, PLAYER_COPY } from '@raven/wren'
import { COLLECTION_KINDS, collectionPath } from '@/routes'

const { album } = FIXTURE_SERVER

type PageProps = { page: Page }

type NamedProps = { page: Page; name: string }

type TrackProps = { page: Page; title: string }

/** What the fixture's album's tile is called aloud wherever a grid draws it. */
export const ALBUM_TILE = KIT_COPY.labelled({ label: album.title, value: album.artist })

/**
 * The sidebar, which the wide layout draws beside every page but sign-in and Now Playing: the
 * navigation whose Home link is named Home alone, where the phone's tab bar says which tab it is.
 */
export const sidebar = ({ page }: PageProps): Locator =>
  page
    .getByRole('navigation')
    .filter({ has: page.getByRole('link', { name: HOME_COPY.title, exact: true }) })

/** A place in the sidebar. */
export const sideLink = ({ page, name }: NamedProps): Locator =>
  sidebar({ page }).getByRole('link', { name, exact: true })

/** The shell's foot, which holds the player bar while a track is queued. */
export const playerBar = ({ page }: PageProps): Locator => page.getByRole('contentinfo')

/** The bar's button that opens Now Playing, named for the track it shows. */
export const nowPlayingButton = ({ page, title }: TrackProps): Locator =>
  playerBar({ page }).getByRole('button', {
    name: PLAYER_COPY.open({ title, artists: album.artist }),
  })

/** Opens the fixture's album from Library's Albums. */
export const openAlbum = async ({ page }: PageProps) => {
  await page.goto(collectionPath(COLLECTION_KINDS.albums))
  await page.getByRole('link', { name: ALBUM_TILE, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
}

/** Plays the fixture's album from its page, and waits for the bar to show its first track. */
export const playAlbum = async ({ page }: PageProps) => {
  await openAlbum({ page })
  await page.getByRole('main').getByRole('button', { name: PLAYER_COPY.play, exact: true }).click()
  await expect(nowPlayingButton({ page, title: album.tracks[0] })).toBeVisible()
}

type NumberedTrackProps = { position: number; title: string }

/** A tracklist row's button, read out with its place in the list: "2. Dawn Song". */
export const numberedTrack = ({ position, title }: NumberedTrackProps): string =>
  `${position}. ${title}`

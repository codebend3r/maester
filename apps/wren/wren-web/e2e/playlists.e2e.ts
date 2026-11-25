import { expect, test, type APIRequestContext } from '@playwright/test'
import { ROUTES, isPlaylistList, pathFor } from '@raven/core'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import {
  KIT_COPY,
  LIBRARY_PAGE_COPY,
  NEW_PLAYLIST_COPY,
  PLAYLIST_COPY,
  TRACK_MENU_COPY,
} from '@raven/wren'
import { openAlbum } from '@/e2e/shell'
import { COLLECTION_KINDS, collectionPath } from '@/routes'

const { album } = FIXTURE_SERVER
const [, secondTrack] = album.tracks

const PLAYLIST_NAME = 'Before breakfast'

type RequestProps = { request: APIRequestContext }

/*
 * Deletes the test's playlist through the API, since Wren has no way to delete one, so the
 * fixture is left as it was found and a retry starts with none.
 */
const deleteTestPlaylists = async ({ request }: RequestProps) => {
  const listed: unknown = await (await request.get(ROUTES.listPlaylists.path)).json()
  if (!isPlaylistList(listed)) throw new Error('The fixture did not list its playlists')
  await Promise.all(
    listed
      .filter((playlist) => playlist.name === PLAYLIST_NAME)
      .map((playlist) =>
        request.delete(pathFor({ path: ROUTES.deletePlaylist.path, params: { id: playlist.id } })),
      ),
  )
}

test.describe('Playlists', () => {
  test.afterEach(async ({ request }) => {
    await deleteTestPlaylists({ request })
  })

  test('makes a playlist, adds a song to it from the song menu, and lists it', async ({ page }) => {
    await page.goto(collectionPath(COLLECTION_KINDS.playlists))
    await expect(page.getByRole('heading', { name: LIBRARY_PAGE_COPY.noPlaylists })).toBeVisible()

    await page.getByRole('button', { name: NEW_PLAYLIST_COPY.title }).first().click()
    const form = page.getByRole('dialog', { name: NEW_PLAYLIST_COPY.title })
    await form.getByRole('textbox', { name: NEW_PLAYLIST_COPY.name }).fill(PLAYLIST_NAME)
    await form.getByRole('button', { name: NEW_PLAYLIST_COPY.create }).click()
    await expect(page.getByText(LIBRARY_PAGE_COPY.created(PLAYLIST_NAME))).toBeVisible()

    await openAlbum({ page })
    await page.getByRole('button', { name: KIT_COPY.more(secondTrack) }).click()
    const menu = page.getByRole('dialog', { name: secondTrack })
    await menu.getByRole('button', { name: TRACK_MENU_COPY.addToPlaylist }).click()
    await page.getByRole('button', { name: new RegExp(`^${PLAYLIST_NAME}`, 'u') }).click()
    await expect(page.getByText(TRACK_MENU_COPY.added(PLAYLIST_NAME))).toBeVisible()

    await page.goto(collectionPath(COLLECTION_KINDS.playlists))
    await page
      .getByRole('main')
      .getByRole('link', { name: new RegExp(`^${PLAYLIST_NAME}`, 'u') })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: PLAYLIST_NAME })).toBeVisible()
    await expect(page.getByRole('button', { name: KIT_COPY.more(secondTrack) })).toBeVisible()
    await expect(page.getByText(PLAYLIST_COPY.emptyTitle)).toHaveCount(0)
  })
})

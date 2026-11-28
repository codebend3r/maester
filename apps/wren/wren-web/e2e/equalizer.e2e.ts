import { type APIRequestContext, expect, test } from '@playwright/test'
import {
  ROUTES,
  isLibraryList,
  isPlaylistDetails,
  isPlaylistList,
  isTrackPage,
  pathFor,
} from '@raven/core'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { EQUALIZER_MARK, EQUALIZER_SIZES } from '@raven/ui'
import { DESIGN_COPY } from '@raven/wren'
import { nowPlayingButton, playerBar } from '@/e2e/shell'
import { WREN_WEB_ONLY_ROUTES, playlistPath } from '@/routes'

const { album } = FIXTURE_SERVER
const [firstTrack] = album.tracks

const PLAYLIST_NAME = 'Equalizer check'

const EQUALIZER = `[${EQUALIZER_MARK}]`

type RequestProps = { request: APIRequestContext }

/** The fixture album's tracks' ids, in its order, read from its music library. */
const albumTrackIds = async ({ request }: RequestProps): Promise<number[]> => {
  const libraries: unknown = await (await request.get(ROUTES.listLibraries.path)).json()
  if (!isLibraryList(libraries)) throw new Error('The fixture did not list its libraries')
  const music = libraries.find((library) => library.name === album.library)
  if (music === undefined) throw new Error('The fixture has no music library')
  const listed: unknown = await (
    await request.get(pathFor({ path: ROUTES.listTracks.path, params: { id: music.id } }))
  ).json()
  if (!isTrackPage(listed)) throw new Error('The fixture did not list its tracks')
  return album.tracks.flatMap((title) =>
    listed.tracks.filter((track) => track.title === title).map((track) => track.id),
  )
}

/** Makes the test's playlist of the fixture album's tracks through the API, and hands back its id. */
const makeTestPlaylist = async ({ request }: RequestProps): Promise<number> => {
  const made: unknown = await (
    await request.post(ROUTES.createPlaylist.path, { data: { name: PLAYLIST_NAME } })
  ).json()
  if (!isPlaylistDetails(made)) throw new Error('The fixture did not make the playlist')
  const id = made.playlist.id
  await request.post(pathFor({ path: ROUTES.appendPlaylistTracks.path, params: { id } }), {
    data: { mediaIds: await albumTrackIds({ request }) },
  })
  return id
}

/** Deletes the test's playlists through the API, since Wren has no way to delete one. */
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

test.describe('Equalizer', () => {
  test.afterEach(async ({ request }) => {
    await deleteTestPlaylists({ request })
  })

  test("shows in the playing song's playlist row and in the player bar", async ({
    page,
    request,
  }) => {
    const id = await makeTestPlaylist({ request })
    await page.goto(playlistPath(id))
    await expect(page.getByRole('heading', { level: 1, name: PLAYLIST_NAME })).toBeVisible()
    const main = page.getByRole('main')
    await expect(main.locator(EQUALIZER)).toHaveCount(0)

    await main
      .getByRole('button', { name: new RegExp(firstTrack, 'u') })
      .first()
      .click()
    await expect(nowPlayingButton({ page, title: firstTrack })).toBeVisible()
    await expect(main.locator(EQUALIZER)).toHaveCount(1)
    await expect(
      main.getByRole('button').filter({ has: page.locator(EQUALIZER) }),
    ).toHaveAccessibleName(new RegExp(firstTrack, 'u'))
    await expect(playerBar({ page }).locator(EQUALIZER)).toBeVisible()
  })

  test('the design page shows it at its three sizes', async ({ page }) => {
    await page.goto(WREN_WEB_ONLY_ROUTES.design)
    await expect(
      page.getByRole('heading', { name: DESIGN_COPY.components.equalizers }),
    ).toBeVisible()
    await expect(page.locator(EQUALIZER)).toHaveCount(Object.values(EQUALIZER_SIZES).length)
  })
})

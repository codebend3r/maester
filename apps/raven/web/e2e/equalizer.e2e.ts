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
import { generatePath } from 'react-router-dom'
import { NOW_PLAYING_BAR_COPY } from '@/components/NowPlayingBar/copy'
import { TRACK_LIST_COPY } from '@/components/TrackList/copy'
import { APP_PATHS } from '@/lib/appPaths'
import { MUSIC_PATHS } from '@/lib/musicPaths'
import { SECTION_IDS, sectionTitle } from '@/pages/DesignPage/contents'
import { PLAYLIST_PAGE_COPY } from '@/pages/PlaylistPage/copy'

const { album } = FIXTURE_SERVER
const [firstTrack, secondTrack] = album.tracks

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

/** Deletes the test's playlists, so the fixture is left as it was found and a retry starts with none. */
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

  test("shows in the playing track's playlist row and in the mini-player", async ({
    page,
    request,
  }) => {
    const id = await makeTestPlaylist({ request })
    await page.goto(generatePath(MUSIC_PATHS.playlist, { id: String(id) }))
    await expect(page.getByRole('heading', { level: 1, name: PLAYLIST_NAME })).toBeVisible()
    const tracks = page.getByRole('list', { name: PLAYLIST_PAGE_COPY.tracks })
    const row = (title: string) => tracks.getByRole('listitem').filter({ hasText: title })
    await expect(tracks.locator(EQUALIZER)).toHaveCount(0)

    await tracks.getByRole('button', { name: TRACK_LIST_COPY.play(firstTrack) }).click()
    await expect(row(firstTrack).locator(EQUALIZER)).toBeVisible()
    await expect(row(secondTrack).locator(EQUALIZER)).toHaveCount(0)
    const bar = page.getByRole('region', { name: NOW_PLAYING_BAR_COPY.miniPlayer })
    await expect(bar.locator(EQUALIZER)).toBeVisible()
  })

  test('the design page shows it at its three sizes', async ({ page }) => {
    await page.goto(APP_PATHS.design)
    const components = page.getByRole('region', { name: sectionTitle(SECTION_IDS.components) })
    await expect(components.locator(EQUALIZER)).toHaveCount(Object.values(EQUALIZER_SIZES).length)
  })
})

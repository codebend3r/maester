import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { ALBUM_COPY, KIT_COPY, LIBRARY_PAGE_COPY } from '@raven/wren'
import { ALBUM_TILE, numberedTrack, openAlbum } from '@/e2e/shell'
import { COLLECTION_KINDS, WREN_ROUTES, collectionPath } from '@/routes'

const { album } = FIXTURE_SERVER
const [, secondTrack] = album.tracks

type CountedProps = { label: string; count: number }

/** A category of Library read out with what it holds: "Albums, 1". */
const counted = ({ label, count }: CountedProps): string =>
  KIT_COPY.labelled({ label, value: String(count) })

test.describe('Library', () => {
  test('lists its categories with what each holds, and opens Albums on the album', async ({
    page,
  }) => {
    await page.goto(WREN_ROUTES.library)
    const main = page.getByRole('main')
    await expect(
      main.getByRole('link', { name: counted({ label: LIBRARY_PAGE_COPY.artists, count: 1 }) }),
    ).toBeVisible()
    await expect(
      main.getByRole('link', {
        name: counted({ label: LIBRARY_PAGE_COPY.songs, count: album.tracks.length }),
      }),
    ).toBeVisible()

    await main
      .getByRole('link', { name: counted({ label: LIBRARY_PAGE_COPY.albums, count: 1 }) })
      .click()
    await expect(
      page.getByRole('heading', { level: 1, name: LIBRARY_PAGE_COPY.albums }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: ALBUM_TILE, exact: true })).toBeVisible()
  })

  test("an album's page lists its tracks in order under its artist", async ({ page }) => {
    await openAlbum({ page })
    const main = page.getByRole('main')
    await expect(
      main.getByRole('link', { name: ALBUM_COPY.openArtist(album.artist) }),
    ).toBeVisible()
    await expect(main.getByRole('button', { name: KIT_COPY.more(album.tracks[0]) })).toBeVisible()
    await Promise.all(
      album.tracks.map((title, index) =>
        expect(
          main.getByRole('button', {
            name: numberedTrack({ position: index + 1, title }),
            exact: true,
          }),
        ).toBeVisible(),
      ),
    )
  })

  test('Artists opens the artist, whose page leads to the album', async ({ page }) => {
    await page.goto(collectionPath(COLLECTION_KINDS.artists))
    await page.getByRole('main').getByRole('link', { name: album.artist }).click()
    await expect(page.getByRole('heading', { level: 1, name: album.artist })).toBeVisible()

    await page.getByRole('link', { name: ALBUM_TILE, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
  })

  test('Songs lists every song, and its search box narrows them to the one named', async ({
    page,
  }) => {
    await page.goto(collectionPath(COLLECTION_KINDS.songs))
    const main = page.getByRole('main')
    await Promise.all(
      album.tracks.map((title) =>
        expect(main.getByRole('button', { name: title, exact: true })).toBeVisible(),
      ),
    )

    await page.getByRole('searchbox', { name: LIBRARY_PAGE_COPY.searchSongs }).fill(secondTrack)
    await expect(main.getByRole('button', { name: KIT_COPY.more(secondTrack) })).toBeVisible()
    await expect(main.getByRole('button', { name: KIT_COPY.more(album.tracks[0]) })).toHaveCount(0)

    await page.getByRole('searchbox', { name: LIBRARY_PAGE_COPY.searchSongs }).fill('no such song')
    await expect(main.getByText(LIBRARY_PAGE_COPY.noMatches)).toBeVisible()
  })
})

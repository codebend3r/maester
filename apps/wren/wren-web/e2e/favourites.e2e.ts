import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { LIBRARY_PAGE_COPY, PLAYER_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { ALBUM_TILE, openAlbum } from '@/e2e/shell'
import { COLLECTION_KINDS, collectionPath } from '@/routes'

const { album } = FIXTURE_SERVER
const [, secondTrack] = album.tracks

test.describe('Favourites', () => {
  test("a song's heart puts it under Favourites, and takes it off again", async ({ page }) => {
    await openAlbum({ page })
    const heart = page.getByRole('button', { name: TRACK_MENU_COPY.likeSong(secondTrack) })
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')

    await page.goto(collectionPath(COLLECTION_KINDS.favourites))
    const kept = page.getByRole('button', { name: TRACK_MENU_COPY.likeSong(secondTrack) })
    await expect(kept).toHaveAttribute('aria-pressed', 'true')

    await kept.click()
    await expect(page.getByText(LIBRARY_PAGE_COPY.noFavourites)).toBeVisible()
  })

  test("an album's Like puts it under Favourites, and takes it off again", async ({ page }) => {
    await openAlbum({ page })
    const like = page.getByRole('switch', { name: PLAYER_COPY.like })
    await like.click()
    await expect(like).toBeChecked()

    await page.goto(collectionPath(COLLECTION_KINDS.favourites))
    await page.getByRole('link', { name: ALBUM_TILE }).click()
    await expect(like).toBeChecked()

    await like.click()
    await expect(like).not.toBeChecked()
    await page.goto(collectionPath(COLLECTION_KINDS.favourites))
    await expect(page.getByText(LIBRARY_PAGE_COPY.noFavourites)).toBeVisible()
  })
})

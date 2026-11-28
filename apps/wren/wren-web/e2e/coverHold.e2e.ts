import { expect, type Locator, type Page, test } from '@playwright/test'
import { TOUCH_HOLD_DELAY_MS } from '@raven/core'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { COVER_FACT_LABELS, TRACK_MENU_COPY } from '@raven/wren'
import { ALBUM_TILE, nowPlayingButton, playAlbum } from '@/e2e/shell'
import { COLLECTION_KINDS, collectionPath } from '@/routes'

const { album } = FIXTURE_SERVER
const [firstTrack] = album.tracks

// Longer than the hold, so the menu is up before the finger lifts, as a listener's would be.
const RESTING_MS = TOUCH_HOLD_DELAY_MS * 2

/** Chrome's touch input over the DevTools protocol: its method and the two moments a hold is made of. */
const TOUCH_INPUT = {
  method: 'Input.dispatchTouchEvent',
  start: 'touchStart',
  end: 'touchEnd',
} as const

type HoldProps = { page: Page; target: Locator }

/**
 * A finger resting on the middle of `target` and lifting, through Chrome's own touch input, so
 * the browser makes its pointer events, its long press menu and the click a lift makes.
 */
const holdOn = async ({ page, target }: HoldProps) => {
  const box = await target.boundingBox()
  if (box === null) throw new Error('the cover to hold is on screen')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const touch = await page.context().newCDPSession(page)
  await touch.send(TOUCH_INPUT.method, { type: TOUCH_INPUT.start, touchPoints: [point] })
  await page.waitForTimeout(RESTING_MS)
  await touch.send(TOUCH_INPUT.method, { type: TOUCH_INPUT.end, touchPoints: [] })
  await touch.detach()
}

/** A tile's cover: the first thing its link holds, the art or the note in its place. */
const coverOf = (tile: Locator): Locator => tile.locator(':scope > *').first()

test.describe('Holding a cover on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("an album tile's cover opens its menu, which goes to the artist and to the album", async ({
    page,
  }) => {
    const albums = collectionPath(COLLECTION_KINDS.albums)
    await page.goto(albums)
    const tile = page.getByRole('link', { name: ALBUM_TILE, exact: true })

    await holdOn({ page, target: coverOf(tile) })

    const menu = page.getByRole('dialog', { name: album.title })
    await expect(menu).toBeVisible()
    await expect(page).toHaveURL(albums)
    await expect(menu.getByText(album.artist)).toBeVisible()
    await expect(menu.getByText(COVER_FACT_LABELS.tracks)).toBeVisible()
    await expect(menu.getByText(COVER_FACT_LABELS.format)).toBeVisible()

    await menu.getByRole('button', { name: TRACK_MENU_COPY.goToArtist }).click()
    await expect(page.getByRole('heading', { level: 1, name: album.artist })).toBeVisible()

    await page.goto(albums)
    await holdOn({ page, target: coverOf(tile) })
    await page
      .getByRole('dialog', { name: album.title })
      .getByRole('button', { name: TRACK_MENU_COPY.goToAlbum })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
  })

  test('a short tap on the cover still opens the album', async ({ page }) => {
    await page.goto(collectionPath(COLLECTION_KINDS.albums))

    await coverOf(page.getByRole('link', { name: ALBUM_TILE, exact: true })).tap()

    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test("the mini player's cover opens the playing song's menu, which goes to its artist", async ({
    page,
  }) => {
    await playAlbum({ page })

    await holdOn({ page, target: coverOf(nowPlayingButton({ page, title: firstTrack })) })

    const menu = page.getByRole('dialog', { name: firstTrack })
    await expect(menu).toBeVisible()
    await expect(menu.getByText(album.title)).toBeVisible()
    await menu.getByRole('button', { name: TRACK_MENU_COPY.goToArtist }).click()
    await expect(page.getByRole('heading', { level: 1, name: album.artist })).toBeVisible()
  })
})

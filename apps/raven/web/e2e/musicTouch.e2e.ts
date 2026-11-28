import { expect, type Locator, type Page, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { MUSIC_FACT_LABELS, MUSIC_LINK_COPY, TOUCH_HOLD_DELAY_MS } from '@raven/core'
import { NOW_PLAYING_BAR_COPY } from '@/components/NowPlayingBar/copy'
import { TRACK_LIST_COPY } from '@/components/TrackList/copy'
import { MUSIC_PATHS } from '@/lib/musicPaths'
import { ALBUM_COPY } from '@/pages/AlbumPage/copy'

const { album } = FIXTURE_SERVER
const [firstTrack] = album.tracks

// A phone: a touch screen at a phone's width, so a held cover is a finger's.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

/** The events a finger's press is made of, as the page hears them. */
const PRESS_EVENTS = { down: 'pointerdown', up: 'pointerup', click: 'click' } as const

/** A finger's pointer, as the hold reads it. */
const FINGER = { pointerType: 'touch', isPrimary: true } as const

type HoldProps = { target: Locator }

/** A finger resting on `target` past the hold's delay, then lifting, as a long press is. */
const hold = async ({ target }: HoldProps) => {
  const box = await target.boundingBox()
  if (box === null) throw new Error('the cover is not on screen')
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
  await target.dispatchEvent(PRESS_EVENTS.down, { ...FINGER, ...at })
  await target.page().waitForTimeout(TOUCH_HOLD_DELAY_MS + 200)
  await target.dispatchEvent(PRESS_EVENTS.up, { ...FINGER, ...at })
  await target.dispatchEvent(PRESS_EVENTS.click, at)
}

type PageProps = { page: Page }

/** The fixture album's cover in the music library's grid. */
const albumCover = ({ page }: PageProps): Locator =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: album.title, exact: true }) })
    .locator('a')
    .first()

test.describe('Music under a finger', () => {
  test('a held album cover tells of the album and goes to its artist or its page, never opening the album as it lifts', async ({
    page,
  }) => {
    await page.goto(MUSIC_PATHS.albums)
    await hold({ target: albumCover({ page }) })

    const menu = page.getByRole('dialog', { name: album.title })
    await expect(menu).toBeVisible()
    await expect(page).toHaveURL(MUSIC_PATHS.albums)
    await expect(menu.getByText(MUSIC_FACT_LABELS.artists, { exact: true })).toBeVisible()
    await expect(menu.getByText(album.artist, { exact: true })).toBeVisible()
    await expect(menu.getByText(MUSIC_FACT_LABELS.tracks, { exact: true })).toBeVisible()

    await menu.getByRole('link', { name: MUSIC_LINK_COPY.goToArtist }).click()
    await expect(page.getByRole('heading', { level: 1, name: album.artist })).toBeVisible()
    await expect(menu).toBeHidden()

    await page.goto(MUSIC_PATHS.albums)
    await hold({ target: albumCover({ page }) })
    await page
      .getByRole('dialog', { name: album.title })
      .getByRole('link', { name: MUSIC_LINK_COPY.goToAlbum })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
  })

  test("the mini-player's held cover tells of the track playing and goes to its album or its artist", async ({
    page,
  }) => {
    await page.goto(MUSIC_PATHS.albums)
    await page.getByRole('link', { name: album.title, exact: true }).click()
    const tracks = page.getByRole('list', { name: ALBUM_COPY.tracks })
    await tracks.getByRole('button', { name: TRACK_LIST_COPY.play(firstTrack) }).click()

    // Back in the page's own history, so the queue plays on rather than leaving with a reload.
    await page.goBack()
    await expect(page).toHaveURL(MUSIC_PATHS.albums)
    const bar = page.getByRole('region', { name: NOW_PLAYING_BAR_COPY.miniPlayer })
    await hold({ target: bar.getByRole('link', { name: NOW_PLAYING_BAR_COPY.nowPlaying }) })

    const menu = page.getByRole('dialog', { name: firstTrack })
    await expect(menu).toBeVisible()
    await expect(page).toHaveURL(MUSIC_PATHS.albums)
    await expect(menu.getByText(MUSIC_FACT_LABELS.album, { exact: true })).toBeVisible()
    await expect(menu.getByText(album.title, { exact: true })).toBeVisible()
    await expect(menu.getByText(MUSIC_FACT_LABELS.quality, { exact: true })).toBeVisible()

    await menu.getByRole('link', { name: MUSIC_LINK_COPY.goToAlbum }).click()
    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()

    await hold({ target: bar.getByRole('link', { name: NOW_PLAYING_BAR_COPY.nowPlaying }) })
    await page
      .getByRole('dialog', { name: firstTrack })
      .getByRole('link', { name: MUSIC_LINK_COPY.goToArtist })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: album.artist })).toBeVisible()
  })
})

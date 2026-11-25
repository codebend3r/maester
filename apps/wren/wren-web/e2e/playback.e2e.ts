import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { KIT_COPY, NOW_PLAYING_COPY, PLAYER_COPY } from '@raven/wren'
import { audioTime } from '@tooling/web/playwright'
import { nowPlayingButton, numberedTrack, openAlbum, playAlbum, playerBar } from '@/e2e/shell'
import { WREN_ROUTES } from '@/routes'

const { album } = FIXTURE_SERVER
const [firstTrack, secondTrack, thirdTrack] = album.tracks

type RowActionProps = { action: string; title: string }

/** One of Up next's row buttons, read out with its song: "Remove, Dawn Song". */
const rowAction = ({ action, title }: RowActionProps): string =>
  KIT_COPY.labelled({ label: action, value: title })

test.describe('Playback', () => {
  test('plays the album from its page, and the bar follows Next and Pause', async ({ page }) => {
    await playAlbum({ page })
    const bar = playerBar({ page })
    await expect(bar.getByRole('button', { name: PLAYER_COPY.pause, exact: true })).toBeVisible()
    await expect.poll(() => audioTime({ page })).toBeGreaterThan(1)

    await bar.getByRole('button', { name: PLAYER_COPY.next, exact: true }).click()
    await expect(nowPlayingButton({ page, title: secondTrack })).toBeVisible()

    await bar.getByRole('button', { name: PLAYER_COPY.pause, exact: true }).click()
    await expect(bar.getByRole('button', { name: PLAYER_COPY.play, exact: true })).toBeVisible()

    await bar.getByRole('button', { name: PLAYER_COPY.previous, exact: true }).click()
    await expect(nowPlayingButton({ page, title: firstTrack })).toBeVisible()
  })

  test('plays from the track pressed, and the rest of the album follows it', async ({ page }) => {
    await openAlbum({ page })
    await page
      .getByRole('main')
      .getByRole('button', {
        name: numberedTrack({ position: 2, title: secondTrack }),
        exact: true,
      })
      .click()
    await expect(nowPlayingButton({ page, title: secondTrack })).toBeVisible()

    await playerBar({ page }).getByRole('button', { name: PLAYER_COPY.next, exact: true }).click()
    await expect(nowPlayingButton({ page, title: thirdTrack })).toBeVisible()
  })

  test('mutes and unmutes from the bar', async ({ page }) => {
    await playAlbum({ page })
    const bar = playerBar({ page })
    await bar.getByRole('button', { name: PLAYER_COPY.mute, exact: true }).click()
    await expect(bar.getByRole('button', { name: PLAYER_COPY.unmute, exact: true })).toBeVisible()

    await bar.getByRole('button', { name: PLAYER_COPY.unmute, exact: true }).click()
    await expect(bar.getByRole('button', { name: PLAYER_COPY.mute, exact: true })).toBeVisible()
  })

  test('Now Playing shows the track over Up next, which a row leaves and Clear empties', async ({
    page,
  }) => {
    await playAlbum({ page })
    await nowPlayingButton({ page, title: firstTrack }).click()
    await expect(page).toHaveURL(WREN_ROUTES.nowPlaying)
    await expect(page.getByRole('heading', { level: 1, name: firstTrack })).toBeVisible()
    await expect(
      page.getByText(NOW_PLAYING_COPY.playingOn(NOW_PLAYING_COPY.devices.browser)),
    ).toBeVisible()

    const remove = page.getByRole('button', {
      name: rowAction({ action: NOW_PLAYING_COPY.remove, title: secondTrack }),
    })
    await expect(remove).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: rowAction({ action: NOW_PLAYING_COPY.remove, title: thirdTrack }),
      }),
    ).toBeVisible()
    await remove.click()
    await expect(remove).toHaveCount(0)

    await page.getByRole('button', { name: NOW_PLAYING_COPY.clearLabel }).click()
    await expect(page.getByText(NOW_PLAYING_COPY.nothingNext)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
    await expect(nowPlayingButton({ page, title: firstTrack })).toBeVisible()
  })
})

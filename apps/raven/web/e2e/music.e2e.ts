import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { NOW_PLAYING_BAR_COPY } from '@/components/NowPlayingBar/copy'
import { TRACK_LIST_COPY } from '@/components/TrackList/copy'
import { ALBUM_COPY } from '@/pages/AlbumPage/copy'
import { sideLink } from '@/e2e/shell'

const { album } = FIXTURE_SERVER
const [firstTrack] = album.tracks

test.describe('Music', () => {
  test('plays a track from its album under the mini-player, and stops', async ({ page }) => {
    await page.goto('/')
    await sideLink({ page, name: APP_SHELL_COPY.music }).click()
    await page.getByRole('link', { name: album.title, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
    const tracks = page.getByRole('list', { name: ALBUM_COPY.tracks })
    await expect(tracks.getByRole('listitem')).toHaveCount(album.tracks.length)

    await tracks.getByRole('button', { name: TRACK_LIST_COPY.play(firstTrack) }).click()
    await expect(
      tracks.getByRole('button', { name: TRACK_LIST_COPY.pause(firstTrack) }),
    ).toBeVisible()
    const bar = page.getByRole('region', { name: NOW_PLAYING_BAR_COPY.miniPlayer })
    await expect(bar.getByRole('link', { name: new RegExp(`^${firstTrack}`, 'u') })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.max(0, ...[...document.querySelectorAll('audio')].map((audio) => audio.currentTime)),
        ),
      )
      .toBeGreaterThan(1)

    await bar.getByRole('button', { name: NOW_PLAYING_BAR_COPY.close }).click()
    await expect(bar).toHaveCount(0)
  })
})

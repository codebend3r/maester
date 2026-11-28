import { expect, type Page, test } from '@playwright/test'
import {
  DOWNLOAD_GROUP_PREFIXES,
  DOWNLOAD_KINDS,
  type DownloadGroup,
  downloadGroupKey,
  type Track,
} from '@raven/core'
import { levelsOf, tapAudioPort } from '@/e2e/audioPort'
import { CLIP_SECONDS, makeMusicClip } from '@/e2e/clips'
import { expectOffline, freshUserData, removeDir, withApp } from '@/e2e/harness'
import { playDownload, seedDownloads } from '@/e2e/seedDownloads'

const ALBUM = { id: 71, title: 'Swells' } as const

const TRACK: Track = {
  id: 701,
  libraryId: 7,
  albumId: ALBUM.id,
  title: 'Swell 01',
  disc: 1,
  number: 1,
  duration: CLIP_SECONDS,
  artists: [{ id: 72, name: 'The Fixtures' }],
  container: 'flac',
  codec: 'flac',
  bitrate: 900_000,
  sampleRate: 44_100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-11-01T00:00:00Z',
  album: { title: ALBUM.title, coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
}

const ALBUM_GROUP: DownloadGroup = {
  kind: DOWNLOAD_KINDS.album,
  key: downloadGroupKey({ prefix: DOWNLOAD_GROUP_PREFIXES.album, ids: [ALBUM.id] }),
  title: ALBUM.title,
  order: 1,
  cover: null,
  sourceId: ALBUM.id,
}

// main reads mpv's meter about 30 times a second and sends at most 25 levels a second.
const LEVELS_WAIT_MS = 10_000
const LEVELS_SEEN = 20
// The clip swells and fades twice a second, so a second of levels holds many loudnesses.
const DISTINCT_LEVELS = 8
const BAR_SAMPLES = 10
const BAR_SAMPLE_MS = 100
// The quiet period after the last send, and a read answered after the pause, may each send one.
const LEVELS_AFTER_PAUSE = 2
const PAUSE_SETTLE_MS = 500

type BarsProps = { page: Page }

/** The page's words and marks the test finds the bar by: `NOW_PLAYING_BAR_COPY.miniPlayer`, its Pause and `EQUALIZER_MARK`. */
const BAR_FINDERS = {
  miniPlayer: 'Mini-player',
  pause: 'Pause',
  equalizer: '[data-equalizer] > span',
} as const

/** The mini-player's equalizer bars, low to high. */
const barsOf = ({ page }: BarsProps) =>
  page.getByRole('region', { name: BAR_FINDERS.miniPlayer }).locator(BAR_FINDERS.equalizer)

/** Each bar's drawn height in pixels, now. */
const barHeights = ({ page }: BarsProps): Promise<number[]> =>
  barsOf({ page }).evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().height))

type SampleBarsProps = { page: Page; remaining: number; taken: readonly string[] }

/** The bars' heights `remaining` times, `BAR_SAMPLE_MS` apart, each as one string. */
const sampleBars = async ({ page, remaining, taken }: SampleBarsProps): Promise<string[]> => {
  if (remaining === 0) return [...taken]
  const heights = await barHeights({ page })
  await page.waitForTimeout(BAR_SAMPLE_MS)
  return sampleBars({ page, remaining: remaining - 1, taken: [...taken, heights.join(',')] })
}

test.describe.serial('music through mpv', () => {
  let userData = ''
  let music = { folder: '', path: '' }

  test.beforeAll(async () => {
    userData = await freshUserData()
    music = await makeMusicClip()
    await seedDownloads({
      userData,
      clips: [
        {
          path: music.path,
          label: TRACK.title,
          mediaId: TRACK.id,
          group: ALBUM_GROUP,
          track: TRACK,
        },
      ],
    })
  })

  test.afterAll(async () => {
    await Promise.all([removeDir(userData), removeDir(music.folder)])
  })

  test('measures what mpv plays, moves the bars with it and stops measuring on pause', async () => {
    await withApp({
      userData,
      run: async ({ page }) => {
        await tapAudioPort({ page })
        await expectOffline({ page })
        await playDownload({ page, label: TRACK.title })

        await expect
          .poll(async () => (await levelsOf({ page })).length, { timeout: LEVELS_WAIT_MS })
          .toBeGreaterThanOrEqual(LEVELS_SEEN)
        const levels = await levelsOf({ page })
        expect(new Set(levels).size).toBeGreaterThanOrEqual(DISTINCT_LEVELS)
        expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(6)

        await expect(barsOf({ page }).first()).toBeVisible()
        const samples = await sampleBars({ page, remaining: BAR_SAMPLES, taken: [] })
        expect(new Set(samples).size).toBeGreaterThan(1)

        await page
          .getByRole('region', { name: BAR_FINDERS.miniPlayer })
          .getByRole('button', {
            name: BAR_FINDERS.pause,
            exact: true,
          })
          .click()
        await page.waitForTimeout(PAUSE_SETTLE_MS)
        const paused = (await levelsOf({ page })).length
        await page.waitForTimeout(PAUSE_SETTLE_MS * 2)
        expect((await levelsOf({ page })).length - paused).toBeLessThanOrEqual(LEVELS_AFTER_PAUSE)
      },
    })
  })
})

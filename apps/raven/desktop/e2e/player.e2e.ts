import { expect, type Page, test } from '@playwright/test'
import { type Clips, makeClips } from '@/e2e/clips'
import {
  expectOffline,
  freshUserData,
  heading,
  removeDir,
  watchedPercent,
  withApp,
} from '@/e2e/harness'
import { episodeGroup, playDownload, seedDownloads } from '@/e2e/seedDownloads'

type VideoFacts = { readyState: number; paused: boolean; currentTime: number }

const videoFacts = (page: Page): Promise<VideoFacts | null> =>
  page.evaluate(() => {
    const video = document.querySelector('video')
    if (video === null) return null
    return { readyState: video.readyState, paused: video.paused, currentTime: video.currentTime }
  })

const isPlaying = (facts: VideoFacts | null): boolean =>
  facts !== null && facts.readyState >= 2 && !facts.paused

const isPaused = (facts: VideoFacts | null): boolean => facts !== null && facts.paused

/**
 * Waits for the clock to move more than a second past where it is now: a video that
 * reports playing while its clock is stuck fails here.
 */
const expectClockAdvancing = async (page: Page) => {
  const start = (await videoFacts(page))?.currentTime ?? Number.POSITIVE_INFINITY
  await expect
    .poll(async () => ((await videoFacts(page))?.currentTime ?? Number.NEGATIVE_INFINITY) - start)
    .toBeGreaterThan(1)
}

type DistanceFromProps = { page: Page; seconds: number }

/** How far the video is from `seconds`, or Infinity before there is a video. */
const distanceFrom = async ({ page, seconds }: DistanceFromProps) => {
  const facts = await videoFacts(page)
  return facts === null ? Number.POSITIVE_INFINITY : Math.abs(facts.currentTime - seconds)
}

// The html engine's suite: with no video engine, a download plays through Chromium.
const MPV = 'off'

// The seeded downloads: two episodes of one show, so the second is up next after the first.
const LABELS = { first: 'Clip 01', second: 'Clip 02 Été' } as const
const SHOW = { id: 10, title: 'Clips' } as const

test.describe.serial('playing a download through the web engine fallback', () => {
  let userData = ''
  let clips: Clips = { folder: '', first: '', second: '' }

  test.beforeAll(async () => {
    userData = await freshUserData()
    clips = await makeClips()
    await seedDownloads({
      userData,
      clips: [
        {
          path: clips.first,
          label: LABELS.first,
          mediaId: 1,
          group: episodeGroup({ showId: SHOW.id, title: SHOW.title, episode: 1 }),
        },
        {
          path: clips.second,
          label: LABELS.second,
          mediaId: 2,
          group: episodeGroup({ showId: SHOW.id, title: SHOW.title, episode: 2 }),
        },
      ],
    })
  })

  test.afterAll(async () => {
    await Promise.all([removeDir(userData), removeDir(clips.folder)])
  })

  test('plays a download, pauses, seeks and resumes after a relaunch', async () => {
    await withApp({
      userData,
      mpv: MPV,
      run: async ({ page }) => {
        await expectOffline({ page })
        await playDownload({ page, label: LABELS.first })
        await expect(heading({ page, name: LABELS.first })).toBeVisible()
        await expect.poll(async () => isPlaying(await videoFacts(page))).toBe(true)
        await expectClockAdvancing(page)

        /*
         * Paused before the seek, so the position main stores is exactly half way: a seek
         * while playing keeps moving until the pause lands.
         */
        await page.keyboard.press('k')
        await expect.poll(async () => isPaused(await videoFacts(page))).toBe(true)
        await page.keyboard.press('5')
        await expect.poll(() => distanceFrom({ page, seconds: 15 })).toBeLessThanOrEqual(1)

        await expect(page.getByRole('link', { name: `Up next: ${LABELS.second}` })).toBeVisible()
        // Main has the position before the app quits.
        await expect.poll(() => watchedPercent({ page, label: LABELS.first })).toBe(50)
      },
    })

    await withApp({
      userData,
      mpv: MPV,
      run: async ({ page }) => {
        await expectOffline({ page })
        await playDownload({ page, label: LABELS.first })
        await expect(page.getByText('Resumed at 0:15')).toBeVisible()
        // The note shows on mount; the video itself starts from there once it plays.
        await expect.poll(async () => isPlaying(await videoFacts(page))).toBe(true)
        await expect
          .poll(async () => (await videoFacts(page))?.currentTime ?? 0)
          .toBeGreaterThanOrEqual(14)
        await expectClockAdvancing(page)
      },
    })
  })
})

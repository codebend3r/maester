import { expect, type Page, test } from '@playwright/test'
import { type Clips, makeClips } from '@/e2e/clips'
import { freshUserData, openFile, removeDir, watchedPercent, withApp } from '@/e2e/harness'

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

/** How far the video is from `seconds`, or Infinity before there is a video. */
const distanceFrom = async ({ page, seconds }: { page: Page; seconds: number }) => {
  const facts = await videoFacts(page)
  return facts === null ? Number.POSITIVE_INFINITY : Math.abs(facts.currentTime - seconds)
}

const homeHeading = (page: Page) => page.getByRole('heading', { name: 'raven player' })

const DRAG_EVENTS = { enter: 'dragenter', drop: 'drop' } as const

/** Sends the window a drag event carrying a File the page made. */
const forgedDrag = ({
  page,
  type,
  name,
}: {
  page: Page
  type: (typeof DRAG_EVENTS)[keyof typeof DRAG_EVENTS]
  name: string
}) =>
  page.evaluate(
    ({ eventType, fileName }) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['x'], fileName, { type: 'video/mp4' }))
      window.dispatchEvent(
        new DragEvent(eventType, { dataTransfer: transfer, bubbles: true, cancelable: true }),
      )
    },
    { eventType: type, fileName: name },
  )

const dropOverlay = (page: Page) => page.getByText('Drop to play')

/**
 * Drags a File the page made over Home until its "Drop to play" shows, which proves the
 * drop listener is attached, then drops it: main refuses it with a notice.
 */
const dropForgedFileOnHome = async ({ page, name }: { page: Page; name: string }) => {
  await expect(async () => {
    await forgedDrag({ page, type: DRAG_EVENTS.enter, name })
    await expect(dropOverlay(page)).toBeVisible({ timeout: 500 })
  }).toPass()
  await forgedDrag({ page, type: DRAG_EVENTS.drop, name })
  await expect(dropOverlay(page)).toBeHidden()
}

/**
 * Drags and drops a File the page made over a video that has played for a while, so the
 * window's drop listener is long attached; the watch route shows no overlay to wait for.
 */
const dropForgedFile = async ({ page, name }: { page: Page; name: string }) => {
  await forgedDrag({ page, type: DRAG_EVENTS.enter, name })
  await forgedDrag({ page, type: DRAG_EVENTS.drop, name })
}

/** A notice over the watch route sits wholly above the controls bar's timeline. */
const expectNoticeClearOfControls = async (page: Page) => {
  await dropForgedFile({ page, name: 'Not a path.mp4' })
  const notice = page.getByText('Drop a video file to play it.')
  await expect(notice).toBeVisible()
  const noticeBox = await notice.boundingBox()
  const timelineBox = await page.getByRole('slider', { name: /seek/i }).boundingBox()
  expect(noticeBox).not.toBeNull()
  expect(timelineBox).not.toBeNull()
  if (noticeBox === null || timelineBox === null) return
  expect(noticeBox.y + noticeBox.height).toBeLessThan(timelineBox.y)
}

// The html engine's suite: with no video engine, local files play through Chromium.
const MPV = 'off'

test.describe.serial('playing a local file through the web engine fallback', () => {
  let userData = ''
  let clips: Clips = { folder: '', first: '', second: '' }

  test.beforeAll(async () => {
    userData = await freshUserData()
    clips = await makeClips()
  })

  test.afterAll(async () => {
    await Promise.all([removeDir(userData), removeDir(clips.folder)])
  })

  test('opens a clip from Finder, plays, pauses, seeks and resumes after a relaunch', async () => {
    await withApp({
      userData,
      mpv: MPV,
      run: async ({ app, page }) => {
        await openFile({ app, path: clips.first })
        await expect(page.getByRole('heading', { name: 'Clip 01', exact: true })).toBeVisible()
        await expect.poll(async () => isPlaying(await videoFacts(page))).toBe(true)
        await expectClockAdvancing(page)

        // Paused before the seek, so the position main stores is exactly half way and the
        // next test can read 50%: a seek while playing keeps moving until the pause lands.
        await page.keyboard.press('k')
        await expect.poll(async () => isPaused(await videoFacts(page))).toBe(true)
        await page.keyboard.press('5')
        await expect.poll(() => distanceFrom({ page, seconds: 15 })).toBeLessThanOrEqual(1)

        // The AppleDouble sidecar and the text file between them are skipped.
        await expect(page.getByRole('link', { name: 'Up next: Clip 02 Été' })).toBeVisible()
        // Main has the position before the app quits.
        await expect.poll(() => watchedPercent({ page, label: 'Clip 01' })).toBe(50)
      },
    })

    await withApp({
      userData,
      mpv: MPV,
      run: async ({ app, page }) => {
        await openFile({ app, path: clips.first })
        await expect(page.getByText('Resumed at 0:15')).toBeVisible()
        // The note shows on mount; the video itself starts from there once it plays.
        await expect.poll(async () => isPlaying(await videoFacts(page))).toBe(true)
        await expect
          .poll(async () => (await videoFacts(page))?.currentTime ?? 0)
          .toBeGreaterThanOrEqual(14)
        await expectClockAdvancing(page)
        await expectNoticeClearOfControls(page)

        // It plays on from 0:15, so park it at half way again for the next test: pause,
        // then 0% (a jump of ten seconds or more saves) and back to 50%, both saved.
        await page.keyboard.press('k')
        await expect.poll(async () => isPaused(await videoFacts(page))).toBe(true)
        await page.keyboard.press('0')
        await expect.poll(() => distanceFrom({ page, seconds: 0 })).toBeLessThanOrEqual(1)
        await page.keyboard.press('5')
        await expect.poll(() => distanceFrom({ page, seconds: 15 })).toBeLessThanOrEqual(1)
        await expect.poll(() => watchedPercent({ page, label: 'Clip 01' })).toBe(50)
      },
    })
  })

  test('lists recents after a relaunch and removes one', async () => {
    await withApp({
      userData,
      mpv: MPV,
      run: async ({ page }) => {
        const recent = page.getByRole('button', { name: 'Clip 01' })
        await expect(recent).toBeVisible()
        await expect(page.getByRole('progressbar', { name: '50% watched' })).toBeVisible()

        await recent.click()
        await expect(page.getByRole('heading', { name: 'Clip 01', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(homeHeading(page)).toBeVisible()

        await page.getByRole('button', { name: 'Remove from recents' }).click()
        await expect(page.getByText('Nothing opened yet.')).toBeVisible()
      },
    })
  })

  test('refuses a File the page made', async () => {
    await withApp({
      userData,
      mpv: MPV,
      run: async ({ page }) => {
        await expect(homeHeading(page)).toBeVisible()
        // Named for a real video, so a path taken from the name would play it.
        await dropForgedFileOnHome({ page, name: clips.first })

        await expect(page.getByRole('status')).toHaveText('Drop a video file to play it.')
        expect(page.url()).toBe('app://raven/')
        await expect(homeHeading(page)).toBeVisible()
      },
    })
  })
})

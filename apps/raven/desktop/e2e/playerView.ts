import { expect, type Page } from '@playwright/test'
import { heading } from '@/e2e/harness'

/** A pointer move wakes the controls, which hold their clock while hidden. */
export const wake = async (page: Page): Promise<void> => {
  await page.mouse.move(120, 120)
  await page.mouse.move(160, 140)
}

/** Waits for a control of the player, woken first. */
export const expectButton = async ({ page, name }: { page: Page; name: string }) => {
  await wake(page)
  await expect(page.getByRole('button', { name })).toBeVisible()
}

/** The scrubber's position in whole seconds, read with the controls awake; null before there is one. */
export const clockOf = async (page: Page): Promise<number | null> => {
  await wake(page)
  const now = await page.getByRole('slider', { name: 'Seek' }).getAttribute('aria-valuenow')
  return now === null ? null : Number(now)
}

/** The clock moves more than a second past where it is now: a stuck clock fails here. */
export const expectClockAdvancing = async (page: Page): Promise<void> => {
  const start = (await clockOf(page)) ?? Number.POSITIVE_INFINITY
  await expect
    .poll(async () => ((await clockOf(page)) ?? Number.NEGATIVE_INFINITY) - start)
    .toBeGreaterThan(1)
}

/** How far the clock is from `seconds`, or Infinity before there is one. */
export const distanceFrom = async ({ page, seconds }: { page: Page; seconds: number }) => {
  const now = await clockOf(page)
  return now === null ? Number.POSITIVE_INFINITY : Math.abs(now - seconds)
}

/** mpv plays it: the page has no `<video>`, and the stage says its picture is native. */
export const expectNative = async (page: Page): Promise<void> => {
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'native')
}

/** mpv plays `title`, the player's heading, and its clock moves. */
export const expectPlayingNatively = async ({
  page,
  title,
}: {
  page: Page
  title: string
}): Promise<void> => {
  await expect(heading({ page, name: title })).toBeVisible()
  await expectNative(page)
  await expectButton({ page, name: 'Pause (k)' })
  await expectClockAdvancing(page)
}

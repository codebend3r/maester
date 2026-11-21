import { expect, type Page } from '@playwright/test'
import { heading } from '@/e2e/harness'

/** The player's words, as its bar and its menus say them. */
export const PLAYER_COPY = {
  gotIt: 'Got it',
  back: 'Back',
  play: 'Play (k)',
  pause: 'Pause (k)',
  skipBack: 'Back 10 seconds (j)',
  skipForward: 'Forward 10 seconds (l)',
  restart: 'Back to the start (Home)',
  previous: (title: string) => `Previous: ${title}`,
  next: (title: string) => `Next: ${title}`,
  nothingUpNext: 'Nothing up next',
  closeMenu: 'Close menu',
  on: 'On',
  off: 'Off',
  autoplay: 'Autoplay',
  shuffle: 'Shuffle',
  nowPlaying: 'Now playing',
  english: 'English',
  french: 'French',
  skipIntro: 'Skip intro',
} as const

/** The pills that open a menu, by the first word of their label. */
export const PLAYER_MENUS = {
  subtitles: 'Subtitles',
  audio: 'Audio',
  playback: 'Playback',
  queue: 'Queue',
} as const

type PlayerMenu = (typeof PLAYER_MENUS)[keyof typeof PLAYER_MENUS]

/** How the page says mpv draws the picture under it. */
export const SURFACE = { attribute: 'data-surface', native: 'native' } as const

/** A pointer move wakes the controls, which hold their clock while hidden. */
export const wake = async (page: Page): Promise<void> => {
  await page.mouse.move(120, 120)
  await page.mouse.move(160, 140)
}

type ExpectButtonProps = { page: Page; name: string }

/** Waits for a control of the player, woken first. */
export const expectButton = async ({ page, name }: ExpectButtonProps) => {
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

type DistanceFromProps = { page: Page; seconds: number }

/** How far the clock is from `seconds`, or Infinity before there is one. */
export const distanceFrom = async ({ page, seconds }: DistanceFromProps) => {
  const now = await clockOf(page)
  return now === null ? Number.POSITIVE_INFINITY : Math.abs(now - seconds)
}

/** mpv plays it: the page has no `<video>`, and the stage says its picture is native. */
export const expectNative = async (page: Page): Promise<void> => {
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute(SURFACE.attribute, SURFACE.native)
}

type ExpectPlayingNativelyProps = {
  page: Page
  title: string
}

/** mpv plays `title`, the player's heading, and its clock moves. */
export const expectPlayingNatively = async ({
  page,
  title,
}: ExpectPlayingNativelyProps): Promise<void> => {
  await expect(heading({ page, name: title })).toBeVisible()
  await expectNative(page)
  await expectButton({ page, name: PLAYER_COPY.pause })
  await expectClockAdvancing(page)
}

type PageProps = { page: Page }

type ControlProps = PageProps & { name: string }

/** A button of the player's bar by its whole label, woken first. */
export const control = async ({ page, name }: ControlProps) => {
  await wake(page)
  return page.getByRole('button', { name, exact: true })
}

type OpenMenuProps = PageProps & { menu: PlayerMenu }

/** Opens one of the bar's menus by its pill, and answers the menu. */
export const openMenu = async ({ page, menu }: OpenMenuProps) => {
  await wake(page)
  await page.getByRole('button', { name: new RegExp(`^${menu}`, 'u') }).click()
  const dialog = page.getByRole('dialog', { name: menu })
  await expect(dialog).toBeVisible()
  return dialog
}

export const closeMenu = async ({ page }: PageProps) => {
  await page.getByRole('button', { name: PLAYER_COPY.closeMenu, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

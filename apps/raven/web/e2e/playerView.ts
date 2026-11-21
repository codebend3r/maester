import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { ROUTES, WATCH_TARGET_KINDS, type WatchedChange } from '@raven/core'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import {
  CONTROLS_COPY,
  MENU_TITLES,
  SETTINGS_MENU_COPY,
  SHORTCUTS_TIP_COPY,
  STAGE_COPY,
} from '@raven/ui/headless'
import { SEASON_GRID_COPY } from '@/components/SeasonGrid/copy'
import { COMMON_COPY } from '@/lib/copy'
import { SEASON_COPY } from '@/pages/SeasonPage/copy'
import { openFromShelf } from '@/e2e/shell'

const { movie, show } = FIXTURE_SERVER

/** The player's words, as its bar and its menus say them, read from the player itself. */
export const PLAYER_COPY = {
  ...CONTROLS_COPY,
  ...SETTINGS_MENU_COPY,
  gotIt: SHORTCUTS_TIP_COPY.dismiss,
  skipIntro: STAGE_COPY.skipIntro,
} as const

/** The pills that open a menu, by the first word of their label. */
export const PLAYER_MENUS = MENU_TITLES

type PlayerMenu = (typeof PLAYER_MENUS)[keyof typeof PLAYER_MENUS]

/** The player's key that seeks to the end, which is how a test reaches a video's last frame. */
export const END_KEY = 'End'

/** An episode of the fixture's series as the player names it: "Lantern Bay · S01E02 · High Water". */
type EpisodeNumber = 1 | 2

export const episodeLabel = (number: EpisodeNumber): string =>
  `${show.title} · S01E0${number} · ${show.episodes[number - 1]}`

type PageProps = { page: Page }

const videoOf = ({ page }: PageProps): Locator => page.locator('video')

/** A pointer move wakes the controls, which hide and hold still while nothing stirs. */
const wake = async ({ page }: PageProps) => {
  await page.mouse.move(200, 200)
  await page.mouse.move(240, 220)
}

type ControlProps = PageProps & { name: string }

/** A button of the player's bar by its whole label, woken first. */
export const control = async ({ page, name }: ControlProps): Promise<Locator> => {
  await wake({ page })
  return page.getByRole('button', { name, exact: true })
}

/** Where the video is, in seconds. */
export const timeOf = ({ page }: PageProps): Promise<number> =>
  videoOf({ page }).evaluate((element: HTMLVideoElement) => element.currentTime)

export const isPaused = ({ page }: PageProps): Promise<boolean> =>
  videoOf({ page }).evaluate((element: HTMLVideoElement) => element.paused)

/** The picture is decoding: its clock moves past where it is now. */
export const expectAdvancing = async ({ page }: PageProps) => {
  const start = await timeOf({ page })
  await expect.poll(() => timeOf({ page }), { timeout: 30_000 }).toBeGreaterThan(start + 1)
}

/** Waits for the video to play, and puts away the keyboard tip a first video raises over the menus. */
const settle = async ({ page }: PageProps) => {
  await expect.poll(() => timeOf({ page }), { timeout: 30_000 }).toBeGreaterThan(0)
  const gotIt = page.getByRole('button', { name: PLAYER_COPY.gotIt, exact: true })
  if (await gotIt.isVisible()) await gotIt.click()
}

/** Plays the fixture's film from its page. */
export const playFilm = async ({ page }: PageProps) => {
  await openFromShelf({ page, library: movie.library, title: movie.title })
  await page.getByRole('link', { name: COMMON_COPY.play, exact: true }).click()
  await settle({ page })
}

type PlayEpisodeProps = PageProps & { number: EpisodeNumber }

/** Plays an episode of the fixture's series from its season's page, so it plays in that season. */
export const playEpisode = async ({ page, number }: PlayEpisodeProps) => {
  await openFromShelf({ page, library: show.library, title: show.title })
  await page.getByRole('link', { name: new RegExp(`^${SEASON_GRID_COPY.season(1)}`, 'u') }).click()
  await page
    .getByRole('link', { name: SEASON_COPY.playEpisode(show.episodes[number - 1]), exact: true })
    .click()
  await settle({ page })
}

/** The episode on screen is `number`: the player's header names it, and its picture plays. */
export const expectEpisode = async ({ page, number }: PlayEpisodeProps) => {
  await wake({ page })
  await expect(page.getByText(show.episodes[number - 1], { exact: true }).first()).toBeVisible()
  await expect.poll(() => timeOf({ page }), { timeout: 30_000 }).toBeGreaterThan(0)
}

type OpenMenuProps = PageProps & { menu: PlayerMenu }

/** Opens one of the bar's menus by its pill, and answers the menu. */
export const openMenu = async ({ page, menu }: OpenMenuProps): Promise<Locator> => {
  await wake({ page })
  await page.getByRole('button', { name: new RegExp(`^${menu}`, 'u') }).click()
  const dialog = page.getByRole('dialog', { name: menu })
  await expect(dialog).toBeVisible()
  return dialog
}

export const closeMenu = async ({ page }: PageProps) => {
  await page.getByRole('button', { name: PLAYER_COPY.closeMenu, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

const WATCH_ID = /\/watch\/(\d+)/u

/** Notes every video a page plays, by the id its address names, so a test can clear what it left. */
const trackPlayed = ({ page }: PageProps): Set<number> => {
  const played = new Set<number>()
  page.on('framenavigated', (frame) => {
    const id = WATCH_ID.exec(frame.url())?.[1] ?? null
    if (id !== null) played.add(Number(id))
  })
  return played
}

type ForgetPlayedProps = PageProps & { played: ReadonlySet<number> }

/**
 * Leaves the player, then marks each video it played watched and then not, which also clears the
 * spot saved for it, so the fixture is left as it was found.
 */
const forgetPlayed = async ({ page, played }: ForgetPlayedProps) => {
  await page.goto('/')
  await expect(page.getByRole('region', { name: movie.library })).toBeVisible()
  const targets = [...played].map((id) => ({ kind: WATCH_TARGET_KINDS.media, id }))
  if (targets.length === 0) return
  const mark = async (watched: boolean) => {
    const data: WatchedChange = { watched, targets }
    const answer = await page.request.put(ROUTES.setWatched.path, { data })
    expect(answer.ok()).toBe(true)
  }
  await mark(true)
  await mark(false)
}

/**
 * The suite's `test`, whose page notes what it plays and, once the test is over, clears it: every
 * test that plays a video takes its `page` from here.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const played = trackPlayed({ page })
    await use(page)
    await forgetPlayed({ page, played })
  },
})

type MenuProps = { menu: Locator }

/** The Queue menu's rows, one a video, in the order they play. */
export const queueRows = ({ menu }: MenuProps): Locator =>
  menu.getByRole('list', { name: PLAYER_MENUS.queue }).getByRole('button')

type SwitchProps = MenuProps & { group: string; choice: string }

/** One choice of a menu's on or off setting, such as Autoplay's Off. */
export const switchChoice = ({ menu, group, choice }: SwitchProps): Locator =>
  menu.getByRole('group', { name: group }).getByRole('radio', { name: choice })

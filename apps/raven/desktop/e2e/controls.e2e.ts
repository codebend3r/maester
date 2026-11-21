import { expect, type Page, test } from '@playwright/test'
import { PLAYBACK_MODES, PLAYER_COMMANDS, describeMode } from '@raven/core'
import { makeClips, makeTrackClip } from '@/e2e/clips'
import { FIXTURE_INTRO, FIXTURE_MOVIE_NAMES, FIXTURE_TITLES } from '@/e2e/fixtureLibrary'
import { type FixtureServer, startWebFixture } from '@/e2e/fixtureServer'
import {
  closeApp,
  freshUserData,
  goHome,
  heading,
  type Launched,
  launchApp,
  removeDir,
  serverEnv,
  signIn,
} from '@/e2e/harness'
import { expectTaken, sentOf, tapPlayerPort } from '@/e2e/playerPort'
import {
  PLAYER_COPY,
  PLAYER_MENUS,
  SURFACE,
  clockOf,
  closeMenu,
  control,
  distanceFrom,
  expectButton,
  expectClockAdvancing,
  expectNative,
  openMenu,
  wake,
} from '@/e2e/playerView'

const EPISODES = {
  1: {
    title: FIXTURE_TITLES.firstEpisode,
    label: `${FIXTURE_TITLES.show} · S01E01 · ${FIXTURE_TITLES.firstEpisode}`,
  },
  2: {
    title: FIXTURE_TITLES.secondEpisode,
    label: `${FIXTURE_TITLES.show} · S01E02 · ${FIXTURE_TITLES.secondEpisode}`,
  },
} as const

type EpisodeNumber = keyof typeof EPISODES

/** The fixture's two subtitle tracks, as mpv is told to show them. */
const SUBTITLE_IDS = { embedded: 'embedded-0', sidecar: 'external-0' } as const

/** The player's keys that seek to the start and to the end. */
const START_KEY = 'Home'
const END_KEY = 'End'

/** How near a seek lands to where it was sent. */
const SEEK_SLACK_SECONDS = 3

/** Longer than the second within which another skip the same way goes further. */
const BETWEEN_SKIPS_MS = 1_200

/** Long enough for a next that plays itself to have started. */
const HOLD_MS = 3_000

type PageProps = { page: Page }

/*
 * mpv plays, from the start: the page has no picture of its own, and its clock moves. A title a
 * test before this one played would carry on from where that left it, toward the end of a short
 * clip, so each starts over. The first video's keyboard tip is put away.
 */
const settle = async ({ page }: PageProps) => {
  await expectNative(page)
  await expectButton({ page, name: PLAYER_COPY.pause })
  await page.keyboard.press(START_KEY)
  await expectClockAdvancing(page)
  const gotIt = page.getByRole('button', { name: PLAYER_COPY.gotIt, exact: true })
  if (await gotIt.isVisible()) await gotIt.click()
}

/** Plays the fixture's first movie, which has two audio tracks and two subtitle tracks, from its page. */
const playMovie = async ({ page }: PageProps) => {
  await goHome({ page })
  await page.getByRole('link', { name: FIXTURE_TITLES.first, exact: true }).click()
  await page.getByRole('link', { name: 'Play', exact: true }).click()
  await expect(heading({ page, name: FIXTURE_MOVIE_NAMES.first })).toBeVisible()
  await settle({ page })
}

type PlayEpisodeProps = PageProps & { number: EpisodeNumber }

/** Plays an episode of the fixture's show from its season's page, so it plays in that season. */
const playEpisode = async ({ page, number }: PlayEpisodeProps) => {
  await goHome({ page })
  await page
    .getByRole('region', { name: 'Fixture Shows' })
    .getByRole('link', { name: FIXTURE_TITLES.show, exact: true })
    .click()
  await page.getByRole('link', { name: new RegExp(`^${FIXTURE_TITLES.season}`, 'u') }).click()
  await page.getByRole('link', { name: `Play ${EPISODES[number].title}`, exact: true }).click()
  await settle({ page })
}

/** The episode on screen is `number`: the player's header names it, and mpv plays it. */
const expectEpisode = async ({ page, number }: PlayEpisodeProps) => {
  await wake(page)
  await expect(page.getByText(EPISODES[number].title, { exact: true }).first()).toBeVisible()
  await expectNative(page)
  await expectClockAdvancing(page)
}

/** Back to the page the player was opened from, with mpv stopped. */
const leavePlayer = async ({ page }: PageProps) => {
  await (await control({ page, name: PLAYER_COPY.back })).click()
  await expect(page.locator('html')).not.toHaveAttribute(SURFACE.attribute, SURFACE.native)
}

// The web's own player controls, pressed in Raven's window, with mpv playing the server's titles.
test.describe.serial("the player's buttons in Raven", () => {
  let userData = ''
  let folders: string[] = []
  let started: FixtureServer | null = null
  let launched: Launched | null = null

  const running = (): Launched => {
    if (launched === null) throw new Error('Raven is not running.')
    return launched
  }

  test.beforeAll(async () => {
    userData = await freshUserData()
    const [clips, track] = await Promise.all([makeClips(), makeTrackClip()])
    folders = [clips.folder, track.folder]
    started = await startWebFixture({
      clips: { first: clips.first, second: clips.second, tracks: track.path },
    })
    launched = await launchApp({ userData, env: serverEnv({ origin: started.origin }) })
    const { page } = launched
    await signIn({ page })
    await tapPlayerPort({ page })
    await expect(heading({ page, name: 'Home' })).toBeVisible()
  })

  test.afterAll(async () => {
    const quit = launched === null ? Promise.resolve() : closeApp({ app: launched.app })
    await quit.finally(async () => {
      await Promise.all([
        started === null ? undefined : started.close(),
        removeDir(userData),
        ...folders.map((folder) => removeDir(folder)),
      ])
    })
  })

  test.afterEach(async () => {
    const { page } = running()
    const isPlaying =
      (await page.locator('html').getAttribute(SURFACE.attribute)) === SURFACE.native
    if (isPlaying) await leavePlayer({ page })
  })

  test('pauses and plays from the bar', async () => {
    const { page } = running()
    await playMovie({ page })
    await (await control({ page, name: PLAYER_COPY.pause })).click()
    await expectButton({ page, name: PLAYER_COPY.play })
    await expectTaken({ page, type: PLAYER_COMMANDS.pause })
    const held = await clockOf(page)
    await page.waitForTimeout(BETWEEN_SKIPS_MS)
    expect(await clockOf(page)).toBe(held)

    await (await control({ page, name: PLAYER_COPY.play })).click()
    await expectButton({ page, name: PLAYER_COPY.pause })
    await expectClockAdvancing(page)
  })

  test('jumps forward and back ten seconds, and back to the start', async () => {
    const { page } = running()
    await playEpisode({ page, number: 1 })
    await (await control({ page, name: PLAYER_COPY.pause })).click()
    await expectButton({ page, name: PLAYER_COPY.play })
    const start = (await clockOf(page)) ?? 0

    await (await control({ page, name: PLAYER_COPY.skipForward })).click()
    await expect
      .poll(() => distanceFrom({ page, seconds: start + 10 }))
      .toBeLessThan(SEEK_SLACK_SECONDS)
    await page.waitForTimeout(BETWEEN_SKIPS_MS)
    await (await control({ page, name: PLAYER_COPY.skipBack })).click()
    await expect.poll(() => distanceFrom({ page, seconds: start })).toBeLessThan(SEEK_SLACK_SECONDS)

    // The first of its season has no video before it, so its button starts it over.
    await (await control({ page, name: PLAYER_COPY.skipForward })).click()
    await (await control({ page, name: PLAYER_COPY.restart })).click()
    await expect.poll(() => distanceFrom({ page, seconds: 0 })).toBeLessThan(SEEK_SLACK_SECONDS)
  })

  test('goes on to the next episode and back to the one before', async () => {
    const { page } = running()
    await playEpisode({ page, number: 1 })
    await (await control({ page, name: PLAYER_COPY.next(EPISODES[2].label) })).click()
    await expectEpisode({ page, number: 2 })
    await expect(await control({ page, name: PLAYER_COPY.nothingUpNext })).toBeDisabled()

    await (await control({ page, name: PLAYER_COPY.previous(EPISODES[1].label) })).click()
    await expectEpisode({ page, number: 1 })
    await expect(await control({ page, name: PLAYER_COPY.next(EPISODES[2].label) })).toBeEnabled()
  })

  test('turns subtitles on, switches the track and turns them off', async () => {
    const { page } = running()
    await playMovie({ page })
    const already = (await sentOf({ page, type: PLAYER_COMMANDS.subtitle })).length
    const menu = await openMenu({ page, menu: PLAYER_MENUS.subtitles })
    const tracks = menu.getByRole('group', { name: PLAYER_MENUS.subtitles }).getByRole('radio')
    // Off, then the file's own track, then its sidecar.
    await expect(tracks).toHaveCount(3)
    await expect(tracks.nth(0)).toBeChecked()

    await tracks.nth(1).check()
    await expectTaken({ page, type: PLAYER_COMMANDS.subtitle })
    await tracks.nth(2).check()
    await expectTaken({ page, type: PLAYER_COMMANDS.subtitle })
    await tracks.nth(0).check()
    await expectTaken({ page, type: PLAYER_COMMANDS.subtitle })

    expect((await sentOf({ page, type: PLAYER_COMMANDS.subtitle })).slice(already)).toMatchObject([
      { id: SUBTITLE_IDS.embedded },
      { id: SUBTITLE_IDS.sidecar },
      { id: null },
    ])
    await closeMenu({ page })
    await expectClockAdvancing(page)
  })

  test('skips the intro from its button, which goes once the intro is behind', async () => {
    const { page } = running()
    await playEpisode({ page, number: 2 })
    const skip = page.getByRole('button', { name: PLAYER_COPY.skipIntro, exact: true })
    await expect
      .poll(async () => (await clockOf(page)) ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(FIXTURE_INTRO.start)
    await expect(skip).toBeVisible()

    await skip.click()
    await expectTaken({ page, type: PLAYER_COMMANDS.seek })
    expect((await sentOf({ page, type: PLAYER_COMMANDS.seek })).at(-1)).toMatchObject({
      time: FIXTURE_INTRO.end,
    })
    await expect
      .poll(() => distanceFrom({ page, seconds: FIXTURE_INTRO.end }))
      .toBeLessThan(SEEK_SLACK_SECONDS)
    await expect(skip).toHaveCount(0)
  })

  test('switches the audio track and plays on', async () => {
    const { page } = running()
    await playMovie({ page })
    const menu = await openMenu({ page, menu: PLAYER_MENUS.audio })
    const audio = menu.getByRole('group', { name: PLAYER_MENUS.audio })
    await expect(audio.getByRole('radio', { name: PLAYER_COPY.english })).toBeChecked()

    await audio.getByRole('radio', { name: PLAYER_COPY.french }).check()
    await expect(audio.getByRole('radio', { name: PLAYER_COPY.french })).toBeChecked()
    await expectTaken({ page, type: PLAYER_COMMANDS.audio })
    expect((await sentOf({ page, type: PLAYER_COMMANDS.audio })).at(-1)).toMatchObject({ index: 1 })

    // Put back, so the next test finds the track the file starts on.
    await audio.getByRole('radio', { name: PLAYER_COPY.english }).check()
    await expectTaken({ page, type: PLAYER_COMMANDS.audio })
    await closeMenu({ page })
    await expectClockAdvancing(page)
  })

  test('offers no other quality, since mpv plays the original file', async () => {
    const { page } = running()
    await playMovie({ page })
    const menu = await openMenu({ page, menu: PLAYER_MENUS.playback })
    await expect(menu.getByText(describeMode(PLAYBACK_MODES.direct), { exact: true })).toBeVisible()
    await expect(
      menu.getByRole('radio', { name: describeMode(PLAYBACK_MODES.transcode) }),
    ).toHaveCount(0)
    await closeMenu({ page })
  })

  test('lists the season in its queue, marks what plays and plays a pick', async () => {
    const { page } = running()
    await playEpisode({ page, number: 1 })
    const menu = await openMenu({ page, menu: PLAYER_MENUS.queue })
    const rows = menu.getByRole('list', { name: PLAYER_MENUS.queue }).getByRole('button')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText(EPISODES[1].label)
    await expect(rows.nth(0)).toContainText(PLAYER_COPY.nowPlaying)
    await expect(rows.nth(0)).toBeDisabled()

    await rows.nth(1).click()
    await expectEpisode({ page, number: 2 })
  })

  test('holds at the end with autoplay off, and rolls on with it on', async () => {
    const { page } = running()
    await playEpisode({ page, number: 1 })
    const menu = await openMenu({ page, menu: PLAYER_MENUS.queue })
    const autoplay = menu.getByRole('group', { name: PLAYER_COPY.autoplay })
    await expect(autoplay.getByRole('radio', { name: PLAYER_COPY.on })).toBeChecked()
    await autoplay.getByRole('radio', { name: PLAYER_COPY.off }).check()
    await closeMenu({ page })

    await page.keyboard.press(END_KEY)
    await page.waitForTimeout(HOLD_MS)
    await expect(await control({ page, name: PLAYER_COPY.next(EPISODES[2].label) })).toBeEnabled()
    await expect(
      page.getByRole('button', { name: PLAYER_COPY.previous(EPISODES[1].label), exact: true }),
    ).toHaveCount(0)
    await leavePlayer({ page })

    // The choice is this profile's, so the episode opened again still has it.
    await playEpisode({ page, number: 1 })
    const again = await openMenu({ page, menu: PLAYER_MENUS.queue })
    const kept = again.getByRole('group', { name: PLAYER_COPY.autoplay })
    await expect(kept.getByRole('radio', { name: PLAYER_COPY.off })).toBeChecked()
    await kept.getByRole('radio', { name: PLAYER_COPY.on }).check()
    await closeMenu({ page })
    await page.keyboard.press(END_KEY)
    await expectEpisode({ page, number: 2 })
  })

  test('shuffles the rest of the season without stopping, and puts it back', async () => {
    const { page } = running()
    await playEpisode({ page, number: 2 })
    await expect(await control({ page, name: PLAYER_COPY.nothingUpNext })).toBeDisabled()
    const loads = (await sentOf({ page, type: PLAYER_COMMANDS.load })).length

    const menu = await openMenu({ page, menu: PLAYER_MENUS.queue })
    const shuffle = menu.getByRole('group', { name: PLAYER_COPY.shuffle })
    await expect(shuffle.getByRole('radio', { name: PLAYER_COPY.off })).toBeChecked()
    // The server deals the queue, so the choice lands once it answers.
    await shuffle.getByRole('radio', { name: PLAYER_COPY.on }).click()

    // The last of its season has nothing after it in order; dealt again, the other episode follows.
    const rows = menu.getByRole('list', { name: PLAYER_MENUS.queue }).getByRole('button')
    await expect(rows.nth(0)).toContainText(PLAYER_COPY.nowPlaying)
    await expect(rows.nth(1)).toContainText(EPISODES[1].label)
    await expect(shuffle.getByRole('radio', { name: PLAYER_COPY.on })).toBeChecked()

    await shuffle.getByRole('radio', { name: PLAYER_COPY.off }).click()
    await expect(rows.nth(1)).toContainText(PLAYER_COPY.nowPlaying)
    await shuffle.getByRole('radio', { name: PLAYER_COPY.on }).click()
    await expect(rows.nth(0)).toContainText(PLAYER_COPY.nowPlaying)
    await closeMenu({ page })
    // Dealing and putting back change what surrounds the video, never the video: mpv loads nothing.
    expect((await sentOf({ page, type: PLAYER_COMMANDS.load })).length).toBe(loads)

    await (await control({ page, name: PLAYER_COPY.next(EPISODES[1].label) })).click()
    await expectEpisode({ page, number: 1 })
    // A shuffle has no order but the one it played, so Previous goes back to what came before.
    await expect(
      await control({ page, name: PLAYER_COPY.previous(EPISODES[2].label) }),
    ).toBeEnabled()
  })
})

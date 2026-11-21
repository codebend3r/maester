import { expect } from '@playwright/test'
import { PLAYBACK_MODES, describeMode } from '@raven/core'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import {
  END_KEY,
  PLAYER_COPY,
  PLAYER_MENUS,
  closeMenu,
  control,
  episodeLabel,
  expectAdvancing,
  expectEpisode,
  isPaused,
  openMenu,
  playEpisode,
  playFilm,
  queueRows,
  switchChoice,
  test,
  timeOf,
} from '@/e2e/playerView'

const { cues, intro } = FIXTURE_SERVER.show

/** How near a seek lands to where it was sent: a keyframe's worth. */
const SEEK_SLACK_SECONDS = 2.5

/** Longer than the second within which another skip the same way goes further. */
const BETWEEN_SKIPS_MS = 1_200

/** Long enough for a next that plays itself to have started. */
const HOLD_MS = 3_000

const LANGUAGES = { english: 'English', spanish: 'Spanish', japanese: 'Japanese' } as const

test.describe("The player's buttons", () => {
  test('pauses and plays from the bar', async ({ page }) => {
    await playEpisode({ page, number: 2 })
    await (await control({ page, name: PLAYER_COPY.pause })).click()
    await expect.poll(() => isPaused({ page })).toBe(true)
    await (await control({ page, name: PLAYER_COPY.play })).click()
    await expect.poll(() => isPaused({ page })).toBe(false)
    await expectAdvancing({ page })
  })

  test('jumps forward and back ten seconds, and back to the start', async ({ page }) => {
    await playEpisode({ page, number: 1 })
    await (await control({ page, name: PLAYER_COPY.pause })).click()
    await expect.poll(() => isPaused({ page })).toBe(true)
    const start = await timeOf({ page })

    await (await control({ page, name: PLAYER_COPY.forward })).click()
    await expect
      .poll(async () => Math.abs((await timeOf({ page })) - (start + 10)))
      .toBeLessThan(SEEK_SLACK_SECONDS)
    await page.waitForTimeout(BETWEEN_SKIPS_MS)
    await (await control({ page, name: PLAYER_COPY.back })).click()
    await expect
      .poll(async () => Math.abs((await timeOf({ page })) - start))
      .toBeLessThan(SEEK_SLACK_SECONDS)

    // The first of its season has no video before it, so its button starts it over.
    await (await control({ page, name: PLAYER_COPY.forward })).click()
    await (await control({ page, name: PLAYER_COPY.restart })).click()
    await expect.poll(() => timeOf({ page })).toBeLessThan(SEEK_SLACK_SECONDS)
  })

  test('goes on to the next episode and back to the one before', async ({ page }) => {
    await playEpisode({ page, number: 1 })
    await (await control({ page, name: PLAYER_COPY.next(episodeLabel(2)) })).click()
    await expectEpisode({ page, number: 2 })
    await expect(await control({ page, name: PLAYER_COPY.nothingUpNext })).toBeDisabled()

    await (await control({ page, name: PLAYER_COPY.previous(episodeLabel(1)) })).click()
    await expectEpisode({ page, number: 1 })
    await expect(await control({ page, name: PLAYER_COPY.next(episodeLabel(2)) })).toBeEnabled()
    await expectAdvancing({ page })
  })

  test('turns subtitles on, switches their language and turns them off', async ({ page }) => {
    await playEpisode({ page, number: 2 })
    const english = page.getByText(cues.english, { exact: true })
    const spanish = page.getByText(cues.spanish, { exact: true })

    const menu = await openMenu({ page, menu: PLAYER_MENUS.subtitles })
    await expect(menu.getByRole('radio', { name: PLAYER_COPY.off })).toBeChecked()
    await expect(english).toHaveCount(0)

    await menu.getByRole('radio', { name: LANGUAGES.english }).check()
    await expect(english).toBeVisible()

    await menu.getByRole('radio', { name: LANGUAGES.spanish }).check()
    await expect(spanish).toBeVisible()
    await expect(english).toHaveCount(0)

    await menu.getByRole('radio', { name: PLAYER_COPY.off }).check()
    await expect(spanish).toHaveCount(0)
    await expect(english).toHaveCount(0)
  })

  test('skips the intro from its button, which goes once the intro is behind', async ({ page }) => {
    await playEpisode({ page, number: 2 })
    const skip = page.getByRole('button', { name: PLAYER_COPY.skipIntro, exact: true })
    await expect.poll(() => timeOf({ page }), { timeout: 30_000 }).toBeGreaterThan(intro.start)
    // The intro's first seconds hold the controls up, so the offer needs no pointer to be seen.
    await expect(skip).toBeVisible()
    expect(await timeOf({ page })).toBeLessThan(intro.end)

    await skip.click()
    await expect
      .poll(async () => Math.abs((await timeOf({ page })) - intro.end))
      .toBeLessThan(SEEK_SLACK_SECONDS)
    await expect(skip).toHaveCount(0)
    await expectAdvancing({ page })
  })

  test('switches the audio track and plays on', async ({ page }) => {
    await playFilm({ page })
    const menu = await openMenu({ page, menu: PLAYER_MENUS.audio })
    await expect(menu.getByRole('radio', { name: LANGUAGES.english })).toBeChecked()

    await menu.getByRole('radio', { name: LANGUAGES.japanese }).check()
    await expect(menu.getByRole('radio', { name: LANGUAGES.japanese })).toBeChecked()
    await closeMenu({ page })
    await expect(
      page.getByRole('button', {
        name: new RegExp(`^${PLAYER_MENUS.audio}: ${LANGUAGES.japanese}`, 'u'),
      }),
    ).toBeVisible()
    await expectAdvancing({ page })
  })

  test('switches the quality between the copied picture and a converted one', async ({ page }) => {
    await playFilm({ page })
    const copied = describeMode(PLAYBACK_MODES.remux)
    const converted = describeMode(PLAYBACK_MODES.transcode)
    const menu = await openMenu({ page, menu: PLAYER_MENUS.playback })
    await expect(menu.getByRole('radio', { name: copied })).toBeChecked()

    await menu.getByRole('radio', { name: converted }).check()
    await expect(menu.getByRole('radio', { name: converted })).toBeChecked()
    await expectAdvancing({ page })

    await menu.getByRole('radio', { name: copied }).check()
    await expect(menu.getByRole('radio', { name: copied })).toBeChecked()
    await expectAdvancing({ page })
  })
})

test.describe("The player's queue", () => {
  test('lists the season in order, marks what plays and plays a pick', async ({ page }) => {
    await playEpisode({ page, number: 1 })
    const menu = await openMenu({ page, menu: PLAYER_MENUS.queue })
    const rows = queueRows({ menu })
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText(episodeLabel(1))
    await expect(rows.nth(0)).toContainText(PLAYER_COPY.nowPlaying)
    await expect(rows.nth(0)).toBeDisabled()
    await expect(rows.nth(1)).toContainText(episodeLabel(2))

    await rows.nth(1).click()
    await expectEpisode({ page, number: 2 })
    const after = await openMenu({ page, menu: PLAYER_MENUS.queue })
    await expect(queueRows({ menu: after }).nth(1)).toContainText(PLAYER_COPY.nowPlaying)
  })

  test('rolls on to the next episode by itself at the end', async ({ page }) => {
    await playEpisode({ page, number: 1 })
    const menu = await openMenu({ page, menu: PLAYER_MENUS.queue })
    await expect(
      switchChoice({ menu, group: PLAYER_COPY.autoplay, choice: PLAYER_COPY.on }),
    ).toBeChecked()
    await closeMenu({ page })

    await page.keyboard.press(END_KEY)
    await expect(await control({ page, name: PLAYER_COPY.previous(episodeLabel(1)) })).toBeEnabled()
    await expectEpisode({ page, number: 2 })
  })

  test('holds at the end once autoplay is turned off in the queue', async ({ page }) => {
    await playEpisode({ page, number: 1 })
    const menu = await openMenu({ page, menu: PLAYER_MENUS.queue })
    await switchChoice({ menu, group: PLAYER_COPY.autoplay, choice: PLAYER_COPY.off }).check()
    await closeMenu({ page })

    // The Playback menu's Autoplay is the same choice.
    const playback = await openMenu({ page, menu: PLAYER_MENUS.playback })
    await expect(
      switchChoice({ menu: playback, group: PLAYER_COPY.autoplay, choice: PLAYER_COPY.off }),
    ).toBeChecked()
    await closeMenu({ page })

    await page.keyboard.press(END_KEY)
    await page.waitForTimeout(HOLD_MS)
    await expect(await control({ page, name: PLAYER_COPY.next(episodeLabel(2)) })).toBeEnabled()
    await expect(
      page.getByRole('button', { name: PLAYER_COPY.previous(episodeLabel(1)), exact: true }),
    ).toHaveCount(0)
  })

  test('shuffles the rest of the season without stopping, and puts it back', async ({ page }) => {
    await playEpisode({ page, number: 2 })
    await expect(await control({ page, name: PLAYER_COPY.nothingUpNext })).toBeDisabled()
    const before = await timeOf({ page })

    const menu = await openMenu({ page, menu: PLAYER_MENUS.queue })
    const shuffle = menu.getByRole('group', { name: PLAYER_COPY.shuffle })
    await expect(shuffle.getByRole('radio', { name: PLAYER_COPY.off })).toBeChecked()
    // The server deals the queue, so the choice lands once it answers.
    await shuffle.getByRole('radio', { name: PLAYER_COPY.on }).click()

    // The last of its season has nothing after it in order; dealt again, the other episode follows.
    const rows = queueRows({ menu })
    await expect(rows.nth(0)).toContainText(PLAYER_COPY.nowPlaying)
    await expect(rows.nth(1)).toContainText(episodeLabel(1))
    await expect(shuffle.getByRole('radio', { name: PLAYER_COPY.on })).toBeChecked()
    expect(await timeOf({ page })).toBeGreaterThanOrEqual(before)

    await shuffle.getByRole('radio', { name: PLAYER_COPY.off }).click()
    await expect(rows.nth(1)).toContainText(PLAYER_COPY.nowPlaying)
    await shuffle.getByRole('radio', { name: PLAYER_COPY.on }).click()
    await expect(rows.nth(0)).toContainText(PLAYER_COPY.nowPlaying)
    await closeMenu({ page })

    await (await control({ page, name: PLAYER_COPY.next(episodeLabel(1)) })).click()
    await expectEpisode({ page, number: 1 })
    // A shuffle has no order but the one it played, so Previous goes back to what came before.
    await expect(await control({ page, name: PLAYER_COPY.previous(episodeLabel(2)) })).toBeEnabled()
  })
})

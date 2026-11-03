import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core'
import { SEASON_GRID_COPY } from '@/components/SeasonGrid/copy'
import { PLAYABLE_ITEM_VIEW_COPY } from '@/components/PlayableItemView/copy'
import { COMMON_COPY } from '@/lib/copy'
import { SEASON_COPY } from '@/pages/SeasonPage/copy'
import { markWatchedAndBack, openFromShelf } from '@/e2e/shell'

const { movie, show } = FIXTURE_SERVER
const [firstEpisode, secondEpisode] = show.episodes

test.describe("A title's page", () => {
  test("shows a film's file and marks it watched, then not", async ({ page }) => {
    await openFromShelf({ page, library: movie.library, title: movie.title })
    await expect(page.getByRole('heading', { name: COMMON_COPY.file })).toBeVisible()
    await markWatchedAndBack({ page })
  })

  test('goes from a series to its season, an episode and the episode after it', async ({
    page,
  }) => {
    await openFromShelf({ page, library: show.library, title: show.title })

    await page
      .getByRole('link', { name: new RegExp(`^${SEASON_GRID_COPY.season(1)}`, 'u') })
      .click()
    await expect(
      page.getByRole('heading', { level: 1, name: SEASON_GRID_COPY.season(1) }),
    ).toBeVisible()
    const episodes = page.getByRole('region', { name: SEASON_COPY.episodes })
    await expect(episodes.getByRole('link', { name: secondEpisode, exact: true })).toBeVisible()

    await episodes.getByRole('link', { name: firstEpisode, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: firstEpisode })).toBeVisible()

    await page
      .getByRole('navigation', { name: PLAYABLE_ITEM_VIEW_COPY.neighbours })
      .getByRole('link', {
        name: PLAYABLE_ITEM_VIEW_COPY.neighbourLabel({
          direction: PLAYABLE_ITEM_VIEW_COPY.next,
          title: secondEpisode,
        }),
      })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: secondEpisode })).toBeVisible()
  })
})

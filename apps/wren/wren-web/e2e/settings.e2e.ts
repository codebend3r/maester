import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { SETTINGS_COPY, STATUS_COPY, THEME_MODES, WREN_THEMES } from '@raven/wren'
import { sidebar } from '@/e2e/shell'
import { WREN_ROUTES } from '@/routes'

const SERVER_NAME = 'Lantern'

test.describe('Settings', () => {
  test('wears the one theme picked, and still wears it after a reload', async ({ page }) => {
    await page.goto(WREN_ROUTES.settings)
    await page.getByRole('radio', { name: SETTINGS_COPY.themeModes[THEME_MODES.single] }).check()
    await page
      .getByRole('radiogroup', { name: SETTINGS_COPY.theme, exact: true })
      .getByRole('radio', { name: SETTINGS_COPY.themeNames[WREN_THEMES.ember] })
      .check()
    await expect(page.locator('html')).toHaveAttribute('data-theme', WREN_THEMES.ember)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', WREN_THEMES.ember)
    await expect(
      page.getByRole('radio', { name: SETTINGS_COPY.themeNames[WREN_THEMES.ember] }),
    ).toBeChecked()
  })

  /*
   * The name is the account's (`server_names`), and the fixture has no accounts, so a name typed
   * here is refused and raven keeps its own.
   */
  test('keeps no name for the server while nobody is signed in', async ({ page }) => {
    await page.goto(WREN_ROUTES.settings)
    const connected = sidebar({ page }).getByText(STATUS_COPY.connected(STATUS_COPY.raven))
    await expect(connected).toBeVisible()

    const name = page.getByRole('textbox', { name: SETTINGS_COPY.serverName })
    await name.fill(SERVER_NAME)
    await name.blur()
    await expect(page.getByRole('main').getByText(SETTINGS_COPY.serverNameNoAccount)).toBeVisible()
    await expect(connected).toBeVisible()
  })

  test('shows the music library worn, the address it plays from and the version', async ({
    page,
  }) => {
    await page.goto(WREN_ROUTES.settings)
    const main = page.getByRole('main')
    await expect(
      main
        .getByRole('radiogroup', { name: SETTINGS_COPY.library })
        .getByRole('radio', { name: FIXTURE_SERVER.album.library }),
    ).toBeChecked()
    await expect(
      main.getByText(`${FIXTURE_SERVER.host}:${FIXTURE_SERVER.wrenWebPort}`),
    ).toBeVisible()
    await expect(main.getByText(SETTINGS_COPY.version)).toBeVisible()
  })
})

import { expect, test } from '@playwright/test'
import { COMMON_COPY } from '@/lib/copy'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { sideLink } from '@/e2e/shell'

test.describe('Settings', () => {
  test('opens on Preferences, and switches to Requests and back', async ({ page }) => {
    await page.goto('/')
    await sideLink({ page, name: COMMON_COPY.settings }).click()
    await expect(page.getByRole('heading', { level: 1, name: COMMON_COPY.settings })).toBeVisible()

    const preferences = page.getByRole('tab', { name: SETTINGS_COPY.tabs.preferences })
    const requests = page.getByRole('tab', {
      name: new RegExp(`^${SETTINGS_COPY.tabs.requests}`, 'u'),
    })
    await expect(preferences).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('region', { name: SETTINGS_COPY.playback })).toBeVisible()

    await requests.click()
    await expect(requests).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: SETTINGS_COPY.requests.heading })).toBeVisible()
    await expect(page.getByRole('region', { name: SETTINGS_COPY.playback })).toHaveCount(0)

    // The arrow keys move between the tabs, choosing as they go.
    await requests.press('ArrowLeft')
    await expect(preferences).toBeFocused()
    await expect(preferences).toHaveAttribute('aria-selected', 'true')
  })

  test("keeps this browser's autoplay choice across a reload, and puts it back", async ({
    page,
  }) => {
    await page.goto('/')
    await sideLink({ page, name: COMMON_COPY.settings }).click()
    const autoplay = page.getByRole('checkbox', {
      name: new RegExp(`^${SETTINGS_COPY.autoplay}`, 'u'),
    })
    const wasOn = await autoplay.isChecked()

    await autoplay.setChecked(!wasOn)
    await page.reload()
    await expect(autoplay).toBeChecked({ checked: !wasOn })

    await autoplay.setChecked(wasOn)
    await expect(autoplay).toBeChecked({ checked: wasOn })
  })
})

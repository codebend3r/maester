import { expect, test } from '@playwright/test'
import { COMMON_COPY } from '@/lib/copy'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { openFromManage } from '@/e2e/shell'

test.describe('Settings', () => {
  test('opens on Playback, switches tabs, and keeps the tab open across a reload', async ({
    page,
  }) => {
    await page.goto('/')
    await openFromManage({ page, name: COMMON_COPY.settings })
    await expect(page.getByRole('heading', { level: 1, name: COMMON_COPY.settings })).toBeVisible()

    const playback = page.getByRole('tab', { name: SETTINGS_COPY.tabs.playback })
    const advanced = page.getByRole('tab', { name: SETTINGS_COPY.tabs.advanced })
    const servers = page.getByRole('tab', { name: SETTINGS_COPY.tabs.servers })
    const requests = page.getByRole('tab', {
      name: new RegExp(`^${SETTINGS_COPY.tabs.requests}`, 'u'),
    })
    const autoplay = page.getByRole('checkbox', {
      name: new RegExp(`^${SETTINGS_COPY.autoplay}`, 'u'),
    })
    await expect(playback).toHaveAttribute('aria-selected', 'true')
    await expect(autoplay).toBeVisible()

    await requests.click()
    await expect(requests).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: SETTINGS_COPY.requests.heading })).toBeVisible()
    await expect(autoplay).toHaveCount(0)

    // The arrow keys move between the tabs, choosing as they go.
    await requests.press('ArrowLeft')
    await expect(advanced).toBeFocused()
    await expect(advanced).toHaveAttribute('aria-selected', 'true')

    await servers.click()
    await expect(page.getByRole('region', { name: SETTINGS_COPY.server.heading })).toBeVisible()
    await page.reload()
    await expect(servers).toHaveAttribute('aria-selected', 'true')
  })

  test("keeps this browser's autoplay choice across a reload, and puts it back", async ({
    page,
  }) => {
    await page.goto('/')
    await openFromManage({ page, name: COMMON_COPY.settings })
    await page.getByRole('tab', { name: SETTINGS_COPY.tabs.playback }).click()
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

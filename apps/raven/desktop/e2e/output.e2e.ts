import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { type Clips, makeClips } from '@/e2e/clips'
import {
  expectOffline,
  freshUserData,
  heading,
  openFile,
  removeDir,
  sideLink,
  withApp,
} from '@/e2e/harness'

const SAVED = 'Sound output saved.'

/** Settings' This computer section, which the frame offers with no server too. */
const openThisComputer = async (page: Page) => {
  await expectOffline({ page })
  await sideLink({ page, name: 'Settings' }).click()
  await expect(page.getByRole('region', { name: 'This computer' })).toBeVisible()
}

const soundOutput = (page: Page) =>
  page.getByRole('region', { name: 'This computer' }).getByRole('group', { name: 'Sound output' })

/** The profile main wrote to `desktop-config.json`, or null before it has. */
const storedProfile = async (userData: string): Promise<unknown> => {
  const text = await readFile(join(userData, 'desktop-config.json'), 'utf8').catch(() => null)
  if (text === null) return null
  const config: unknown = JSON.parse(text)
  if (typeof config !== 'object' || config === null || !('output' in config)) return null
  const { output } = config
  if (typeof output !== 'object' || output === null || !('profile' in output)) return null
  return output.profile
}

test.describe.serial('choosing how this computer sends sound', () => {
  let userData = ''
  let clips: Clips = { folder: '', first: '', second: '' }

  test.beforeAll(async () => {
    userData = await freshUserData()
    clips = await makeClips()
  })

  test.afterAll(async () => {
    await Promise.all([removeDir(userData), removeDir(clips.folder)])
  })

  test('saves Headphones and still has it after a relaunch', async () => {
    await withApp({
      userData,
      run: async ({ page }) => {
        await openThisComputer(page)
        const output = soundOutput(page)
        await expect(output.getByRole('radio', { name: 'Speakers or TV' })).toBeChecked()

        await output.getByRole('radio', { name: 'Headphones' }).check()
        await expect(page.getByText(SAVED)).toBeVisible()
        await expect(output.getByRole('radio', { name: 'Headphones' })).toBeChecked()
        await expect.poll(() => storedProfile(userData)).toBe('headphones')
      },
    })

    await withApp({
      userData,
      run: async ({ page }) => {
        await openThisComputer(page)
        await expect(soundOutput(page).getByRole('radio', { name: 'Headphones' })).toBeChecked()
      },
    })
  })

  test('fixes the volume under receiver passthrough', async () => {
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await openThisComputer(page)
        await soundOutput(page).getByRole('radio', { name: 'Receiver passthrough' }).check()
        await expect(page.getByText(SAVED)).toBeVisible()
        await expect(page.getByText('Volume is set on your receiver.')).toBeVisible()
        await expect.poll(() => storedProfile(userData)).toBe('passthrough')

        await openFile({ app, path: clips.first })
        await expect(heading({ page, name: 'Clip 01' })).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-surface', 'native')
        // The mute button, since the slider hides on a window as narrow as CI's.
        await expect(
          page.getByRole('button', { name: 'Volume is set on your receiver' }),
        ).toBeDisabled()
      },
    })
  })
})

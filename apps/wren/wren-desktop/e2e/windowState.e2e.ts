import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ElectronApplication, expect, test } from '@playwright/test'
import { freshUserData, homeTile, removeFolder, withApp } from '@/e2e/harness'
import { WINDOW_FILE, firstSizeIn, isWindowBounds } from '@/main/windowState'

// Smaller than the first size and away from where Electron centres it, so a restored window is told apart.
const MOVED = { inset: 60, width: 900, height: 640 } as const

type AppProps = { app: ElectronApplication }

const boundsOf = ({ app }: AppProps) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().at(0)?.getBounds() ?? null)

type SavedBoundsProps = { userData: string }

/** What the app has written of its window's place; null until it has. */
const savedBounds = async ({ userData }: SavedBoundsProps) => {
  const text = await readFile(join(userData, WINDOW_FILE), 'utf8').catch(() => '')
  if (text === '') return null
  const saved: unknown = JSON.parse(text)
  return isWindowBounds(saved) ? saved : null
}

test.describe('where the window was', () => {
  let userData = ''

  test.beforeAll(async () => {
    userData = await freshUserData()
  })

  test.afterAll(() => removeFolder({ path: userData }))

  test('opens at its first size, then where it was left on the next launch', async () => {
    const moved = await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeTile({ page })).toBeVisible()
        // A runner's screen can be smaller than the first size, which then fits the screen.
        const primary = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
        expect(await boundsOf({ app })).toMatchObject(firstSizeIn(primary))

        const wanted = await app.evaluate(({ BrowserWindow, screen }, { inset, width, height }) => {
          const { workArea } = screen.getPrimaryDisplay()
          const bounds = { x: workArea.x + inset, y: workArea.y + inset, width, height }
          BrowserWindow.getAllWindows().at(0)?.setBounds(bounds)
          return bounds
        }, MOVED)
        expect(await boundsOf({ app })).toEqual(wanted)
        // The app writes the file as the window moves, so the quit waits for it to be there.
        await expect.poll(() => savedBounds({ userData })).toEqual(wanted)
        return wanted
      },
    })

    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeTile({ page })).toBeVisible()
        expect(await boundsOf({ app })).toEqual(moved)
      },
    })
  })
})

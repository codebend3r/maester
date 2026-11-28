import { type ElectronApplication, expect, test } from '@playwright/test'
import { appForSuite, browserOpens, homeTile, stubBrowser } from '@/e2e/harness'
import { DESKTOP_COPY, PRODUCT_NAME } from '@/main/copy'
import { WEB_SITE } from '@/main/menu'

// The role an unpackaged run's View menu adds, as Electron names it.
const DEV_TOOLS_ROLE = 'toggledevtools'

type AppProps = { app: ElectronApplication }

type ItemProps = { app: ElectronApplication; label: string }

/** The menu bar as Electron built it: each menu's label over its items' labels and roles. */
const readMenu = ({ app }: AppProps) =>
  app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((menu) => ({
      label: menu.label,
      items: (menu.submenu?.items ?? []).map((item) => ({
        label: item.label,
        role: (item.role ?? '').toLowerCase(),
      })),
    })),
  )

/** Chooses an item of the menu bar by its label, as a click on it does. */
const choose = ({ app, label }: ItemProps) =>
  app.evaluate(({ Menu }, wanted) => {
    const item = (Menu.getApplicationMenu()?.items ?? [])
      .flatMap((menu) => menu.submenu?.items ?? [])
      .find((entry) => entry.label === wanted)
    if (item === undefined) throw new Error(`The menu bar has no ${wanted}.`)
    item.click()
  }, label)

const isWindowVisible = ({ app }: AppProps) =>
  app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows()
    return windows.length === 1 && windows.every((window) => window.isVisible())
  })

/** A top-level menu, by its label. */
type MenuNamed = { label: string }

test.describe('the menu bar and the window', () => {
  const running = appForSuite()

  test.beforeAll(async () => {
    await expect(homeTile({ page: running().page })).toBeVisible()
  })

  test("has Wren's menus, with Show Wren under Window and the web site under Help", async () => {
    const menus = await readMenu({ app: running().app })
    expect(menus.map(({ label }) => label)).toEqual([
      PRODUCT_NAME,
      DESKTOP_COPY.menu.file,
      DESKTOP_COPY.menu.edit,
      DESKTOP_COPY.menu.view,
      DESKTOP_COPY.menu.window,
      DESKTOP_COPY.menu.help,
    ])
    const labelsOf = ({ label }: MenuNamed) =>
      (menus.find((menu) => menu.label === label)?.items ?? []).map((item) => item.label)
    expect(labelsOf({ label: DESKTOP_COPY.menu.window })).toContain(DESKTOP_COPY.menu.showWindow)
    expect(labelsOf({ label: DESKTOP_COPY.menu.help })).toEqual([DESKTOP_COPY.menu.webSite])

    // An unpackaged run, which this is, has the developer tools under View.
    const view = menus.find((menu) => menu.label === DESKTOP_COPY.menu.view)?.items ?? []
    expect(view.map(({ role }) => role)).toContain(DEV_TOOLS_ROLE)
  })

  test('hides the window when it is closed, and Show Wren brings it back', async () => {
    const { app, page } = running()
    expect(await isWindowVisible({ app })).toBe(true)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((window) => window.close())
    })
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((window) => window.isVisible()),
        ),
      )
      .toEqual([false])
    // The page lives on behind the hidden window, which is what keeps the queue playing.
    expect(await page.evaluate(() => document.readyState)).toBe('complete')

    await choose({ app, label: DESKTOP_COPY.menu.showWindow })
    await expect.poll(() => isWindowVisible({ app })).toBe(true)
  })

  test('opens Wren on the web in the browser from Help', async () => {
    const { app } = running()
    await stubBrowser({ app })
    await choose({ app, label: DESKTOP_COPY.menu.webSite })
    await expect.poll(() => browserOpens({ app })).toEqual([WEB_SITE])
    expect(await isWindowVisible({ app })).toBe(true)
  })
})

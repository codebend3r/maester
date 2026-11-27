import { expect } from '@playwright/test'
import { SITE_PAGES, open, test } from '@/e2e/site'

// The narrowest screen every page has to work on.
const NARROW = { width: 320, height: 640 } as const

test.describe('At 320 pixels wide', () => {
  test.use({ viewport: NARROW })

  Object.values(SITE_PAGES).forEach((sitePage) => {
    test(`${sitePage.path} never scrolls sideways`, async ({ page }) => {
      await open({ page, sitePage })
      await page.waitForLoadState('networkidle')

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBe(0)
    })
  })
})

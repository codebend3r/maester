import { type Page, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** The WCAG levels a page is held to: A and AA, through 2.2. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

type AxePageProps = { page: Page }

/**
 * Scans the open page with axe-core and throws one Error naming every violation, its impact and
 * the elements it hit, so the suite's output says what to fix without opening a report.
 */
export const expectNoAxeViolations = async ({ page }: AxePageProps) => {
  const { violations } = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze()
  if (violations.length === 0) return
  const lines = violations.map(
    ({ id, impact, help, nodes }) =>
      `${id} (${impact ?? 'unknown'}): ${help}\n${nodes.map(({ target }) => `    ${target.join(' ')}`).join('\n')}`,
  )
  throw new Error(
    `${page.url()} has ${violations.length} accessibility violations\n${lines.join('\n')}`,
  )
}

type AxeSuiteProps = { paths: readonly string[] }

/** One test a page: opens it, lets it settle, and holds it to `expectNoAxeViolations`. */
export const defineAxeSuite = ({ paths }: AxeSuiteProps) =>
  test.describe('Accessibility', () => {
    paths.forEach((path) => {
      test(`${path} has no axe-core violations`, async ({ page }) => {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        await expectNoAxeViolations({ page })
      })
    })
  })

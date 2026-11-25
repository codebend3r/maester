import { describe, expect, it, mock } from 'bun:test'
import { SETTINGS_COPY, WREN_THEMES } from '@raven/wren'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WREN_WEB_ONLY_ROUTES } from '@/routes'
import { renderWithProviders } from '@/test/render'

/*
 * Vite hands the page globals.scss as text; Bun cannot, so the tests put a small stylesheet in
 * its place, with a token of every kind the page draws and two themes like the real ones.
 */
const GLOBALS = `
:root {
  --color-ink: #131416;
  // The space between a row's parts.
  --space-2: 0.5rem;
  --radius-md: 14px;
  --font-display: 'Young Serif', georgia, serif;
  --font-weight-medium: 500;
  --font-size-body: 0.9375rem;
  --line-body: 1.375rem;
  --tracking-overline: 0.06em;
  --size-row: 3.75rem;
  --shadow-card: 0 8px 20px black;
  --type-body: var(--font-weight-medium) var(--font-size-body) / var(--line-body) var(--font-body);
}

:root,
[data-theme='night'] {
  --color-bg: #101816;
  --color-text: #efebe3;

  color-scheme: dark;
}

[data-theme='paper'] {
  --color-bg: #f4efe6;
  --color-text: #131416;

  color-scheme: light;
}
`

mock.module('@/screens/Design/stylesheet', () => ({ stylesheet: GLOBALS }))

const { Design } = await import('@/screens/Design/Design')

const renderDesign = () =>
  renderWithProviders({ ui: <Design />, route: WREN_WEB_ONLY_ROUTES.design, authConfig: null })

describe('Design', () => {
  it('names its five sections in a contents bar', () => {
    renderDesign()
    const contents = screen.getByRole('navigation', { name: 'Contents' })
    expect(
      within(contents)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['01Logo', '02Colour', '03Tokens', '04Text', '05Components'])
  })

  it('shows each theme on its own ground with its colours, and the contrast of its text', () => {
    renderDesign()
    const light = screen.getByRole('region', { name: SETTINGS_COPY.themeNames[WREN_THEMES.paper] })
    const dark = screen.getByRole('region', { name: SETTINGS_COPY.themeNames[WREN_THEMES.night] })
    expect(within(light).getByText('#f4efe6')).toBeTruthy()
    expect(within(dark).getByText('#101816')).toBeTruthy()
    expect(within(light).getAllByText(/to 1 on the ground/).length).toBeGreaterThan(0)
  })

  it('shows the colours no theme changes apart from the palettes', () => {
    renderDesign()
    const fixed = screen.getByRole('list', { name: 'Fixed colours' })
    expect(within(fixed).getByText('--color-ink')).toBeTruthy()
  })

  it('draws every token with its value, and every type style', () => {
    renderDesign()
    const spacing = screen.getByRole('list', { name: 'Spacing' })
    expect(within(spacing).getByText('--space-2')).toBeTruthy()
    expect(within(spacing).getByText("The space between a row's parts.")).toBeTruthy()
    const styles = screen.getByRole('list', { name: 'Type styles' })
    expect(within(styles).getByText('--type-body')).toBeTruthy()
  })

  it('shows the kit in the states a page puts it in', async () => {
    renderDesign()
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unavailable' }).hasAttribute('disabled')).toBe(true)
    const sort = screen.getByRole('radiogroup', { name: 'Sort by' })
    await userEvent.click(within(sort).getByLabelText('Artist'))
    expect(within(sort).getByRole('radio', { name: 'Artist', checked: true })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Icons' })).toBeTruthy()
  })
})

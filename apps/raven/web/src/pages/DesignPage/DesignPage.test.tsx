import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { THEMES, parseTokens } from '@raven/ui'
import { useTheme } from '@/stores/theme'
import { Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'

// Vite hands the page globals.scss as text; Bun cannot, so the tests give it
// a small stylesheet of their own, with a token of every kind the page draws.
mock.module('@raven/ui/designTokens', () => ({
  designTokens: parseTokens(`
    :root {
      --color-night: #15201e;
      --color-canopy: #1c2b28;
      // Text on everything.
      --color-bark: #e6e1d6;
      --color-line: color-mix(in srgb, var(--color-bark) 10%, transparent);
      --color-scrim: rgb(0 0 0 / 55%);
      --glow: 0.6;
      --fade-from-bottom: linear-gradient(to top, rgb(0 0 0 / 75%), rgb(0 0 0 / 0%));
      --shadow-menu: 0 8px 24px rgb(0 0 0 / 40%);
      --shadow-text: 0 1px 2px rgb(0 0 0 / 60%);
      --space-3: 1rem;
      --gutter: clamp(1.25rem, 4vw, 3.5rem);
      --radius-md: 8px;
      --font-display: 'Young Serif', georgia, serif;
      --font-size-xl: 1.75rem;
      --line-body: 1.5;
      --tracking-display: -0.02em;
      --tracking-eyebrow: 0.12em;
      --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
      --max-width: 110rem;
      --control-size: 2.5rem;
      --border-thick: 2px;
      --titlebar-inset: 0px;
      --focus-ring: 2px solid var(--color-bark);
    }
  `),
}))

const { DesignPage } = await import('@/pages/DesignPage/DesignPage')

const swatchesIn = (colours: HTMLElement) =>
  within(within(colours).getByRole('list', { name: 'Every colour' })).getAllByRole('listitem')

describe('DesignPage', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    document.head.querySelectorAll('style[data-test]').forEach((style) => style.remove())
    act(() => useTheme.getState().pick('verdigris'))
    window.localStorage.clear()
  })

  it('shows a swatch for every colour token, with its value, note and contrast', () => {
    renderWithProviders({ ui: <DesignPage /> })
    const colours = screen.getByRole('region', { name: 'Colour' })
    const swatches = swatchesIn(colours)
    expect(swatches.map((swatch) => within(swatch).getByRole('heading').textContent)).toEqual([
      '--color-night',
      '--color-canopy',
      '--color-bark',
      '--color-line',
      '--color-scrim',
    ])
    const bark = swatches[2]
    expect(bark).toHaveTextContent('#e6e1d6')
    expect(bark).toHaveTextContent('Text on everything.')
    expect(bark).toHaveTextContent('On night12.8:1')
    expect(swatches[3]).toHaveTextContent('color-mix(in srgb, var(--color-bark) 10%, transparent)')
    expect(swatches[3]).toHaveTextContent('On nightVaries')
  })

  it('reads each colour off the page, so it follows the theme worn', () => {
    const style = document.createElement('style')
    style.dataset.test = ''
    style.textContent = "[data-theme='patina'] { --color-bark: #1b2825; --color-night: #ebe5d8; }"
    document.head.append(style)
    document.documentElement.style.setProperty('--color-bark', '#FFF')
    renderWithProviders({ ui: <DesignPage /> })
    const colours = screen.getByRole('region', { name: 'Colour' })
    expect(swatchesIn(colours)[2]).toHaveTextContent('#ffffff')

    document.documentElement.removeAttribute('style')
    act(() => useTheme.getState().pick('patina'))
    const bark = swatchesIn(colours)[2]
    expect(bark).toHaveTextContent('#1b2825')
    expect(bark).toHaveTextContent('On night12.2:1')
    // The notes are Verdigris's, so another theme leaves them out.
    expect(bark).not.toHaveTextContent('Text on everything.')
    expect(within(colours).getByRole('list', { name: 'Grounds' })).toHaveTextContent('#ebe5d8')
  })

  it('shows every theme in its own colours, the one worn marked', () => {
    act(() => useTheme.getState().pick('oxblood'))
    renderWithProviders({ ui: <DesignPage /> })
    const strip = within(screen.getByRole('region', { name: 'Colour' })).getByRole('list', {
      name: 'Themes',
    })
    const themes = within(strip).getAllByRole('listitem')
    expect(themes.map((theme) => within(theme).getByRole('heading').textContent)).toEqual(
      THEMES.map((theme) => theme.name),
    )
    expect(themes.map((theme) => theme.dataset.theme)).toEqual(THEMES.map((theme) => theme.id))
    const worn = themes.filter((theme) => theme.hasAttribute('aria-current'))
    expect(worn.map((theme) => theme.dataset.theme)).toEqual(['oxblood'])
    expect(worn[0]).toHaveAttribute('aria-current', 'true')
    expect(worn[0]).toHaveTextContent('Worn now')
  })

  it('shows each version of the logo and the favicon at its sizes', () => {
    renderWithProviders({ ui: <DesignPage /> })
    const logo = screen.getByRole('region', { name: 'Logo' })
    const images = within(logo).getAllByRole('img')
    expect(images.map((image) => [image.getAttribute('alt'), image.getAttribute('src')])).toEqual([
      ['The mark on dark', '/brand/raven-mark-on-dark.svg'],
      ['The mark on light', '/brand/raven-mark-on-light.svg'],
      ['The mark in one colour', '/brand/raven-mark-mono.svg'],
      ['The favicon at 16 pixels', '/favicon.svg'],
      ['The favicon at 32 pixels', '/favicon.svg'],
      ['The favicon at 48 pixels', '/favicon.svg'],
      ['The home screen icon', '/apple-touch-icon.png'],
    ])
    expect(logo).toHaveTextContent('raven')
  })

  it('lists the other tokens by group with their values', () => {
    renderWithProviders({ ui: <DesignPage /> })
    const tokens = screen.getByRole('region', { name: 'Tokens' })
    expect(tokens).toHaveTextContent('--space-3')
    expect(tokens).toHaveTextContent('1rem')
    expect(tokens).toHaveTextContent('--font-size-xl')
    expect(
      within(tokens)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Spacing',
      'Radius',
      'Typefaces',
      'Type scale',
      'Line height',
      'Tracking',
      'Easing',
      'Shadows',
      'Fades and glow',
      'Layout and focus',
    ])
  })

  it('numbers the sections in the contents bar and their headings', () => {
    renderWithProviders({ ui: <DesignPage /> })
    const contents = screen.getByRole('navigation', { name: 'On this page' })
    const links = within(contents).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['01Logo', '/#logo'],
      ['02Colour', '/#colour'],
      ['03Tokens', '/#tokens'],
      ['04Text', '/#text'],
      ['05Forms', '/#forms'],
      ['06Content', '/#content'],
      ['07Components', '/#components'],
    ])
    expect(screen.getByRole('heading', { level: 2, name: 'Components' })).toHaveTextContent(
      '07Components',
    )
  })

  it('scrolls to a section from the contents bar and replaces the address, not pushing one', async () => {
    const scrolled = spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    const Where = () => {
      const { hash } = useLocation()
      return <output aria-label="Address">{`${hash} by ${useNavigationType()}`}</output>
    }
    renderWithProviders({
      ui: (
        <>
          <DesignPage />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </>
      ),
      route: '/design',
      behind: ['/'],
    })
    await userEvent.click(screen.getByRole('link', { name: 'Forms' }))
    expect(screen.getByRole('status', { name: 'Address' })).toHaveTextContent('#forms by REPLACE')
    expect(scrolled.mock.contexts[0]).toBe(document.getElementById('forms'))
    scrolled.mockRestore()
  })

  it('shows every heading level and the common form controls', () => {
    renderWithProviders({ ui: <DesignPage /> })
    const text = screen.getByRole('region', { name: 'Text' })
    expect(
      [1, 2, 3, 4, 5, 6].map((level) => within(text).getAllByRole('heading', { level }).length > 0),
    ).toEqual([true, true, true, true, true, true])
    const forms = screen.getByRole('region', { name: 'Forms' })
    expect(within(forms).getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(within(forms).getAllByRole('radio').length).toBeGreaterThan(0)
    expect(within(forms).getAllByRole('textbox').length).toBeGreaterThan(0)
    expect(within(forms).getAllByRole('combobox').length).toBeGreaterThan(0)
    expect(within(forms).getAllByRole('slider').length).toBeGreaterThan(0)
    expect(within(forms).getByRole('textbox', { name: 'Invalid' })).toHaveAccessibleDescription(
      'Give the library a name.',
    )
  })

  it('shows the app components under their own names', () => {
    renderWithProviders({ ui: <DesignPage /> })
    const components = screen.getByRole('region', { name: 'Components' })
    const names = within(components)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(names).toEqual(
      expect.arrayContaining([
        'Button',
        'Icon',
        'MediaCard',
        'MediaList',
        'MediaTiles',
        'SectionHeading',
        'Skeleton',
      ]),
    )
  })

  it('copies an icon’s name, and says so', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    const copied: string[] = []
    const write = spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copied.push(text)
    })
    renderWithProviders({ ui: <DesignPage /> })
    const film = screen.getByRole('button', { name: 'Copy film' })
    await userEvent.click(film)
    write.mockRestore()
    Reflect.deleteProperty(window, 'isSecureContext')
    expect(copied).toEqual(['film'])
    expect(film).toHaveTextContent('Copied')
    expect(screen.getByRole('status')).toHaveTextContent('Copied film')
  })

  it('says nothing when the copy fails', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    const write = spyOn(navigator.clipboard, 'writeText').mockImplementation(async () => {
      throw new Error('Denied')
    })
    renderWithProviders({ ui: <DesignPage /> })
    const play = screen.getByRole('button', { name: 'Copy play' })
    await userEvent.click(play)
    write.mockRestore()
    Reflect.deleteProperty(window, 'isSecureContext')
    expect(play).toHaveTextContent('play')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})

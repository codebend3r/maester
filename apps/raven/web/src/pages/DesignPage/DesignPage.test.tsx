import { describe, expect, it, mock } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { parseTokens } from '@/lib/tokens'
import { renderWithProviders } from '@/test/render'

// Vite hands the page globals.scss as text; Bun cannot, so the tests give it
// a small stylesheet of their own.
mock.module('@/styles/designTokens', () => ({
  designTokens: parseTokens(`
    :root {
      --color-night: #15201e;
      // Text on everything.
      --color-bark: #e6e1d6;
      --space-3: 1rem;
      --font-size-xl: 1.75rem;
    }
  `),
}))

const { DesignPage } = await import('@/pages/DesignPage/DesignPage')

describe('DesignPage', () => {
  it('shows a swatch for every colour token, with its value and note', () => {
    renderWithProviders(<DesignPage />)
    const colours = screen.getByRole('region', { name: 'Colour' })
    const swatches = within(colours).getAllByRole('listitem')
    expect(swatches.map((swatch) => within(swatch).getByRole('heading').textContent)).toEqual([
      '--color-night',
      '--color-bark',
    ])
    expect(swatches[1]).toHaveTextContent('#e6e1d6')
    expect(swatches[1]).toHaveTextContent('Text on everything.')
  })

  it('lists the other tokens with their values', () => {
    renderWithProviders(<DesignPage />)
    const tokens = screen.getByRole('region', { name: 'Tokens' })
    expect(tokens).toHaveTextContent('--space-3')
    expect(tokens).toHaveTextContent('1rem')
    expect(tokens).toHaveTextContent('--font-size-xl')
  })

  it('shows every heading level and the common form controls', () => {
    renderWithProviders(<DesignPage />)
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
  })

  it('shows the app components under their own names', () => {
    renderWithProviders(<DesignPage />)
    const components = screen.getByRole('region', { name: 'Components' })
    const names = within(components)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(names).toEqual(
      expect.arrayContaining(['Button', 'Icon', 'MediaCard', 'MediaList', 'MediaTiles']),
    )
  })
})

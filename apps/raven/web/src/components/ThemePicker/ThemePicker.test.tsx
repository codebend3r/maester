import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemePicker } from '@/components/ThemePicker/ThemePicker'
import { THEME_KEY, useTheme } from '@/stores/theme'

describe('ThemePicker', () => {
  it('lists every theme with the one worn checked', async () => {
    const user = userEvent.setup()
    render(<ThemePicker />)
    await user.click(screen.getByRole('button', { name: 'Theme' }))

    const options = screen.getAllByRole('menuitemradio')
    expect(options).toHaveLength(7)
    expect(screen.getByRole('menuitemradio', { name: /Verdigris/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemradio', { name: /Verdigris/ })).toHaveFocus()
    expect(screen.getByText('Light parchment, teal ink')).toBeInTheDocument()
  })

  it('wears a picked theme, keeps it and closes', async () => {
    const user = userEvent.setup()
    render(<ThemePicker />)
    const trigger = screen.getByRole('button', { name: 'Theme' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitemradio', { name: /Oxblood/ }))

    expect(useTheme.getState().theme).toBe('oxblood')
    expect(document.documentElement.dataset.theme).toBe('oxblood')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('oxblood')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
    window.localStorage.clear()
  })

  it('moves with the arrows and closes on Escape, back on its button', async () => {
    const user = userEvent.setup()
    render(<ThemePicker />)
    const trigger = screen.getByRole('button', { name: 'Theme' })
    await user.click(trigger)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /Bronze/ })).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('menuitemradio', { name: /High contrast/ })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('closes on a click elsewhere', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ThemePicker />
        <p>Elsewhere</p>
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

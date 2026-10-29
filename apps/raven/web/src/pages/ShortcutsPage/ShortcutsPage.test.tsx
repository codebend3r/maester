import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import { ShortcutsPage } from '@/pages/ShortcutsPage/ShortcutsPage'
import { asDesktop, downloadsMain } from '@/test/desktop'
import { renderWithProviders } from '@/test/render'

describe('ShortcutsPage', () => {
  afterEach(cleanup)

  it('lists the player keys and the frame keys under the keyboard icon', () => {
    renderWithProviders({ ui: <ShortcutsPage /> })
    const title = screen.getByRole('heading', { level: 1, name: 'Shortcuts' })
    expect(title.querySelector('svg')?.dataset.icon).toBe('keyboard')

    const player = screen.getByRole('region', { name: 'While a video plays' })
    expect(within(player).getByText('Play or pause')).toBeInTheDocument()
    expect(within(player).getByText('Full screen')).toBeInTheDocument()
    expect(within(player).queryByText('Video info')).toBeNull()

    const frame = screen.getByRole('region', { name: 'Around raven' })
    expect(within(frame).getByText('B')).toBeInTheDocument()
  })

  it('lists video info inside Raven, whose player has it', () => {
    asDesktop(downloadsMain())
    renderWithProviders({ ui: <ShortcutsPage /> })
    expect(
      within(screen.getByRole('region', { name: 'While a video plays' })).getByText('Video info'),
    ).toBeInTheDocument()
  })
})

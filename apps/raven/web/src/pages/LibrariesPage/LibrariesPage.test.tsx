import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LibraryInput } from '@raven/core'
import { api } from '@/lib/api'
import { LibrariesPage } from '@/pages/LibrariesPage/LibrariesPage'
import { library } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('LibrariesPage', () => {
  const spies = {
    list: spyOn(api, 'listLibraries'),
    update: spyOn(api, 'updateLibrary'),
  }

  afterEach(() => {
    spies.list.mockReset()
    spies.update.mockReset()
  })

  it('unpins a pinned library, changing nothing else', async () => {
    const movies = library({ id: 2, name: 'Movies', paths: ['/media/Movies'] })
    const sent: Array<{ id: number; input: LibraryInput }> = []
    spies.list.mockImplementation(async () => [movies])
    spies.update.mockImplementation(async (request) => {
      sent.push(request)
      return movies
    })
    renderWithProviders(<LibrariesPage />)
    const pin = await screen.findByRole('button', { name: 'Pin Movies' })
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(pin)
    expect(sent).toEqual([
      { id: 2, input: { name: 'Movies', paths: ['/media/Movies'], settings: { pinned: false } } },
    ])
  })

  it('shows a library that is not pinned as unpressed', async () => {
    spies.list.mockImplementation(async () => [
      library({ name: 'Clips', settings: { ...library().settings, pinned: false } }),
    ])
    renderWithProviders(<LibrariesPage />)
    expect(await screen.findByRole('button', { name: 'Pin Clips' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

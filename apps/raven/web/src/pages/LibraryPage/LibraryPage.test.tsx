import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Library, LibraryInput, LibrarySettings, MediaSort } from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { LibraryPage } from '@/pages/LibraryPage/LibraryPage'
import { library, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const ITEMS = [
  mediaItem({ id: 1, title: 'Wide', width: 3840, height: 2160 }),
  mediaItem({ id: 2, title: 'Full', width: 1920, height: 1080 }),
  mediaItem({ id: 3, title: 'Also full', width: 1920, height: 800 }),
]

describe('LibraryPage', () => {
  const spies = {
    get: spyOn(api, 'getLibrary'),
    list: spyOn(api, 'listMedia'),
    update: spyOn(api, 'updateLibrary'),
  }
  const state = {
    sent: [] as LibraryInput[],
    listed: [] as Array<{ sort?: MediaSort; seed?: number }>,
  }

  /** Serves one library whose settings change as the page saves them. */
  const serve = (settings: Partial<LibrarySettings> = {}) => {
    const current: { library: Library } = {
      library: library({ id: 2, settings: { ...library().settings, ...settings } }),
    }
    spies.get.mockImplementation(async () => current.library)
    spies.list.mockImplementation(async (request) => {
      state.listed.push({ sort: request.sort, seed: request.seed })
      return ITEMS
    })
    spies.update.mockImplementation(async ({ input }) => {
      state.sent.push(input)
      current.library = {
        ...current.library,
        settings: { ...current.library.settings, ...input.settings },
      }
      return current.library
    })
    renderWithProviders(
      <Routes>
        <Route path="libraries/:id" element={<LibraryPage />} />
      </Routes>,
      { route: '/libraries/2' },
    )
  }

  afterEach(() => {
    spies.get.mockReset()
    spies.list.mockReset()
    spies.update.mockReset()
    state.sent = []
    state.listed = []
  })

  it('opens in the view and sort the library was left in', async () => {
    serve({ view: 'list', sort: 'largest' })
    expect(await screen.findByRole('table', { name: 'Videos' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sort')).toHaveValue('largest')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(state.listed.at(-1)?.sort).toBe('largest')
  })

  it('saves a new sort to the library and lists in that order', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Highest bitrate')
    expect(state.sent).toEqual([
      { name: 'Movies', paths: ['/media/Movies'], settings: { sort: 'bitrate-high' } },
    ])
    expect(state.listed.at(-1)?.sort).toBe('bitrate-high')
  })

  it('switches the view straight away and saves it', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Tiles' }))
    expect(screen.getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true')
    expect(state.sent.at(-1)?.settings).toEqual({ view: 'tiles' })
  })

  it('groups by resolution, and offers the other groupings only in that view', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    expect(screen.queryByLabelText('Group by')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Grouped' }))
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['4K, 1 video', '1080p, 2 videos'])
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'Video codec')
    expect(state.sent.at(-1)?.settings).toEqual({ groupBy: 'codec' })
  })

  it('deals a new random order when asked to shuffle again', async () => {
    serve({ sort: 'random' })
    await screen.findByRole('link', { name: 'Wide' })
    const first = state.listed.at(-1)?.seed
    expect(first).toBeNumber()
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(state.listed.at(-1)?.seed).not.toBe(first)
  })
})

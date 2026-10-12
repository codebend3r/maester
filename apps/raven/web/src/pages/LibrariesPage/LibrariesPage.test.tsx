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
    lock: spyOn(api, 'getLock'),
  }

  afterEach(() => {
    spies.list.mockReset()
    spies.update.mockReset()
    spies.lock.mockReset()
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

  it('says what type each library is', async () => {
    spies.list.mockImplementation(async () => [
      library({
        name: 'Shows',
        itemCount: 1268,
        settings: { ...library().settings, kind: 'shows' },
      }),
    ])
    renderWithProviders(<LibrariesPage />)
    expect(await screen.findByText('TV shows · 1,268 videos')).toBeInTheDocument()
  })

  it("shows each library's type icon, with a lock on a locked one", async () => {
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Shows', settings: { ...library().settings, kind: 'shows' } }),
      library({
        id: 2,
        name: 'Tutorials',
        settings: { ...library().settings, kind: 'other', locked: true },
      }),
    ])
    renderWithProviders(<LibrariesPage />)
    const iconsBeside = async (name: string) => {
      const icon = (await screen.findByRole('link', { name })).previousElementSibling
      return [...(icon?.querySelectorAll('svg') ?? [])].map((svg) => svg.dataset.icon)
    }
    expect(await iconsBeside('Shows')).toEqual(['tv'])
    expect(await iconsBeside('Tutorials')).toEqual(['video', 'lock'])
  })

  it("lays its newest video's picture behind a row, and nothing where there is none", async () => {
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Films', backdrop: { type: 'item', id: 7, version: 'abc' } }),
      library({ id: 2, name: 'Clips', backdrop: { type: 'thumbnail', id: 9, version: 41 } }),
      library({ id: 3, name: 'Empty' }),
    ])
    renderWithProviders(<LibrariesPage />)
    const pictureBehind = async (name: string) => {
      const row = (await screen.findByRole('link', { name })).closest('li')
      const picture = row?.querySelector('[style]')
      return picture instanceof HTMLElement ? picture.style.backgroundImage : null
    }
    expect(await pictureBehind('Films')).toContain('/api/items/7/images/backdrop?v=abc')
    expect(await pictureBehind('Clips')).toContain('/api/media/9/thumbnail?v=41')
    expect(await pictureBehind('Empty')).toBeNull()
  })

  it("keeps a locked library's folders and picture hidden until this browser has the PIN", async () => {
    // As a list cached from before the lock would still carry them.
    const tutorials = library({
      id: 3,
      name: 'Tutorials',
      paths: ['/media/Tutorials'],
      backdrop: { type: 'thumbnail', id: 9, version: 41 },
      settings: { ...library().settings, locked: true },
    })
    spies.list.mockImplementation(async () => [tutorials])
    spies.lock.mockImplementation(async () => ({ available: true, unlocked: false }))
    renderWithProviders(<LibrariesPage />)
    const row = (await screen.findByRole('link', { name: 'Tutorials' })).closest('li')
    expect(row).toHaveTextContent('Other · Locked · 12 videos')
    expect(row?.querySelector('[style]')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Folders' })).toBeNull()
    expect(screen.queryByText('/media/Tutorials')).toBeNull()
  })

  it('shows an unlocked library like any other, saying it is unlocked', async () => {
    spies.list.mockImplementation(async () => [
      library({
        id: 3,
        name: 'Tutorials',
        paths: ['/media/Tutorials'],
        backdrop: { type: 'thumbnail', id: 9, version: 41 },
        settings: { ...library().settings, locked: true },
      }),
    ])
    spies.lock.mockImplementation(async () => ({ available: true, unlocked: true }))
    renderWithProviders(<LibrariesPage />)
    expect(await screen.findByText('/media/Tutorials')).toBeInTheDocument()
    const row = screen.getByRole('link', { name: 'Tutorials' }).closest('li')
    expect(row).toHaveTextContent('Other · Unlocked · 12 videos')
    expect(row?.querySelector('[style]')).not.toBeNull()
  })

  it('says how many files are not matched, when any are', async () => {
    spies.list.mockImplementation(async () => [
      library({
        name: 'Films',
        itemCount: 1217,
        unmatchedCount: 22,
        settings: { ...library().settings, kind: 'movies' },
      }),
    ])
    renderWithProviders(<LibrariesPage />)
    expect(await screen.findByText('Movies · 1,217 videos · 22 not matched')).toBeInTheDocument()
  })
})

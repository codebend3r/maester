import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Library, LibraryViewChange } from '@raven/core'
import { api } from '@/lib/api'
import { LibrariesPage } from '@/pages/LibrariesPage/LibrariesPage'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import { library, metadataHealth } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

/** The picture laid behind a row; the icons carry a style too, for their size. */
const BACKDROP = '[style*="background-image"]'

describe('LibrariesPage', () => {
  const spies = {
    list: spyOn(api, 'listLibraries'),
    view: spyOn(api, 'setLibraryView'),
    lock: spyOn(api, 'getLock'),
    health: spyOn(api, 'getMetadataHealth'),
    match: spyOn(api, 'matchLibrary'),
  }

  beforeEach(() => {
    spies.lock.mockImplementation(async () => ({ available: false, unlocked: false }))
    spies.health.mockImplementation(async () => metadataHealth())
  })

  afterEach(() => {
    cleanup()
    spies.list.mockReset()
    spies.view.mockReset()
    spies.lock.mockReset()
    spies.health.mockReset()
    spies.match.mockReset()
  })

  it("offers each library's history, a rescan and Edit, each named for its library", async () => {
    spies.list.mockImplementation(async () => [library({ id: 2, name: 'Clips' })])
    renderWithProviders({ ui: <LibrariesPage /> })
    expect(await screen.findByRole('link', { name: 'History Clips' })).toHaveAttribute(
      'href',
      '/libraries/2/history',
    )
    expect(screen.getByRole('button', { name: 'Rescan Clips' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit Clips' })).toBeEnabled()
    // An Other library is never matched.
    expect(screen.queryByRole('button', { name: /^Match again/ })).toBeNull()
  })

  it('matches the files no movie was found for again, and reads the count again', async () => {
    const films = library({
      id: 4,
      name: 'Films',
      unmatchedCount: 3,
      settings: { ...library().settings, kind: 'movies' },
    })
    const matched = { ...films, unmatchedCount: 0 }
    spies.list.mockImplementation(async () => [films])
    spies.health.mockImplementation(async () => metadataHealth())
    spies.match.mockImplementation(async () => matched)
    renderWithProviders({ ui: <LibrariesPage /> })
    const button = await screen.findByRole('button', { name: 'Match again Films' })
    await waitFor(() => expect(button).toBeEnabled())
    spies.list.mockImplementation(async () => [matched])
    await userEvent.click(button)
    expect(spies.match).toHaveBeenCalledWith(4)
    expect(await screen.findByText('Movies · 12 videos')).toBeInTheDocument()
  })

  it('opens Edit on the library, with its name filled in', async () => {
    spies.list.mockImplementation(async () => [library({ id: 2, name: 'Clips' })])
    renderWithProviders({ ui: <LibrariesPage /> })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Clips' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Clips')
  })

  it('asks for the PIN on Edit while the library is locked, as its folders are held back', async () => {
    spies.list.mockImplementation(async () => [
      library({ id: 3, name: 'Tutorials', settings: { ...library().settings, locked: true } }),
    ])
    spies.lock.mockImplementation(async () => ({ available: true, unlocked: false }))
    renderWithProviders({ ui: <LibrariesPage /> })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Tutorials' }))
    expect(useUnlockPrompt.getState().open).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    useUnlockPrompt.setState({ open: false })
  })

  it('unpins a pinned library, changing nothing else', async () => {
    const movies = library({ id: 2, name: 'Movies', paths: ['/media/Movies'] })
    const sent: Array<{ id: number; change: LibraryViewChange }> = []
    spies.list.mockImplementation(async () => [movies])
    spies.view.mockImplementation(async (request) => {
      sent.push(request)
      return movies
    })
    renderWithProviders({ ui: <LibrariesPage /> })
    const pin = await screen.findByRole('button', { name: 'Pin Movies' })
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(pin)
    expect(sent).toEqual([{ id: 2, change: { pinned: false } }])
  })

  it('pins at once, before the server answers', async () => {
    const clips = library({ name: 'Clips', settings: { ...library().settings, pinned: false } })
    spies.list.mockImplementation(async () => [clips])
    spies.view.mockImplementation(() => held<Library>().promise)
    renderWithProviders({ ui: <LibrariesPage /> })
    const pin = await screen.findByRole('button', { name: 'Pin Clips' })
    await userEvent.click(pin)
    await waitFor(() => expect(pin).toHaveAttribute('aria-pressed', 'true'))
    expect(pin).toBeEnabled()
  })

  it('takes the pin back when the server refuses it', async () => {
    const clips = library({ name: 'Clips', settings: { ...library().settings, pinned: false } })
    spies.list.mockImplementation(async () => [clips])
    spies.view.mockImplementation(async () => {
      throw new Error('The server is away.')
    })
    renderWithProviders({ ui: <LibrariesPage /> })
    const pin = await screen.findByRole('button', { name: 'Pin Clips' })
    await userEvent.click(pin)
    await waitFor(() => expect(pin).toHaveAttribute('aria-pressed', 'false'))
  })

  it('reads Pinned on a pinned library and Pin on one that is not, its name the same either way', async () => {
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Films' }),
      library({ id: 2, name: 'Clips', settings: { ...library().settings, pinned: false } }),
    ])
    renderWithProviders({ ui: <LibrariesPage /> })
    const pinned = await screen.findByRole('button', { name: 'Pin Films' })
    const unpinned = screen.getByRole('button', { name: 'Pin Clips' })
    expect(within(pinned).getByText('Pinned')).toHaveAttribute('aria-hidden', 'true')
    expect(within(unpinned).getByText('Pin')).toHaveAttribute('aria-hidden', 'true')
    expect(within(unpinned).queryByText('Pinned')).toBeNull()
  })

  it('says how many libraries there are and how many videos they hold between them', async () => {
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Films', itemCount: 1204 }),
      library({ id: 2, name: 'Clips', itemCount: 12 }),
    ])
    renderWithProviders({ ui: <LibrariesPage /> })
    expect(await screen.findByText('2 libraries · 1,216 videos')).toBeInTheDocument()
  })

  it('counts one library and one video in the singular', async () => {
    spies.list.mockImplementation(async () => [library({ name: 'Clips', itemCount: 1 })])
    renderWithProviders({ ui: <LibrariesPage /> })
    expect(await screen.findByText('1 library · 1 video')).toBeInTheDocument()
  })

  it("lists each of a library's folders", async () => {
    spies.list.mockImplementation(async () => [
      library({ name: 'Shows', paths: ['/media/TV', '/mnt/archive/TV'] }),
    ])
    renderWithProviders({ ui: <LibrariesPage /> })
    const folders = await screen.findByRole('list', { name: 'Folders' })
    expect(
      within(folders)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['/media/TV', '/mnt/archive/TV'])
  })

  it('stands in for the libraries while they are read', async () => {
    spies.list.mockImplementation(() => held<Library[]>().promise)
    renderWithProviders({ ui: <LibrariesPage /> })
    expect(await screen.findByText('Gathering your libraries')).toBeInTheDocument()
  })

  it('shows a library that is not pinned as unpressed', async () => {
    spies.list.mockImplementation(async () => [
      library({ name: 'Clips', settings: { ...library().settings, pinned: false } }),
    ])
    renderWithProviders({ ui: <LibrariesPage /> })
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
    renderWithProviders({ ui: <LibrariesPage /> })
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
    renderWithProviders({ ui: <LibrariesPage /> })
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
    renderWithProviders({ ui: <LibrariesPage /> })
    const pictureBehind = async (name: string) => {
      const row = (await screen.findByRole('link', { name })).closest('li')
      const picture = row?.querySelector(BACKDROP)
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
    renderWithProviders({ ui: <LibrariesPage /> })
    const row = (await screen.findByRole('link', { name: 'Tutorials' })).closest('li')
    expect(row).toHaveTextContent('Other · Locked · 12 videos')
    expect(row?.querySelector(BACKDROP)).toBeNull()
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
    renderWithProviders({ ui: <LibrariesPage /> })
    expect(await screen.findByText('/media/Tutorials')).toBeInTheDocument()
    const row = screen.getByRole('link', { name: 'Tutorials' }).closest('li')
    expect(row).toHaveTextContent('Other · Unlocked · 12 videos')
    expect(row?.querySelector(BACKDROP)).not.toBeNull()
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
    renderWithProviders({ ui: <LibrariesPage /> })
    expect(await screen.findByText('Movies · 1,217 videos · 22 not matched')).toBeInTheDocument()
  })

  it('leaves Add library and Rescan out while the admin lock is on, but keeps the pin', async () => {
    spies.list.mockImplementation(async () => [library({ name: 'Clips' })])
    renderWithProviders({ ui: <LibrariesPage />, adminLock: { state: 'on', available: true } })
    expect(await screen.findByRole('button', { name: 'Pin Clips' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add library' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rescan' })).toBeNull()
  })

  it('says how to add the first library while the admin lock is on', async () => {
    spies.list.mockImplementation(async () => [])
    renderWithProviders({ ui: <LibrariesPage />, adminLock: { state: 'on', available: true } })
    expect(
      await screen.findByText('Turn the admin lock off in Settings to add one.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add library' })).toBeNull()
  })

  it('keeps the way back to Home on the page that has no libraries', async () => {
    spies.list.mockImplementation(async () => [])
    renderWithProviders({ ui: <LibrariesPage /> })
    expect(
      await screen.findByRole('heading', { name: 'Point raven at your videos' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
  })

  it('keeps the way back to Home on the page the server did not answer', async () => {
    spies.list.mockImplementation(async () => {
      throw new Error('offline')
    })
    renderWithProviders({ ui: <LibrariesPage /> })
    expect(
      await screen.findByRole('heading', { name: 'The server did not answer' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
  })

  it('steps back where the app has been browsed, over the list', async () => {
    spies.list.mockImplementation(async () => [library({ id: 2, name: 'Clips' })])
    renderWithProviders({ ui: <LibrariesPage />, route: '/libraries', behind: ['/'] })
    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull()
  })
})

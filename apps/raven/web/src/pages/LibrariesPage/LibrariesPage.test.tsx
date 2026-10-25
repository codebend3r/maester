import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Library, LibraryViewChange } from '@raven/core'
import { api } from '@/lib/api'
import { LibrariesPage } from '@/pages/LibrariesPage/LibrariesPage'
import { useUnlockPrompt } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { fakeAccount } from '@/test/authClient'
import { library, mediaItem, metadataHealth } from '@/test/fixtures'
import { mediaListQuery } from '@/lib/queries'
import { held } from '@/test/held'
import { pollFast } from '@/test/polls'
import { renderWithProviders } from '@/test/render'

/** The picture laid behind a row; the icons carry a style too, for their size. */
const BACKDROP = '[style*="background-image"]'

/** Opens every card, which start folded, once the libraries are there. */
const openAll = async () => {
  const toggles = await screen.findAllByRole('button', { name: /^Expand / })
  await toggles.reduce(
    (done, toggle) => done.then(() => userEvent.click(toggle)),
    Promise.resolve(),
  )
}

const ISO = '2026-10-17T09:00:00.000Z'

describe('LibrariesPage', () => {
  const spies = {
    list: spyOn(api, 'listLibraries'),
    view: spyOn(api, 'setLibraryView'),
    lock: spyOn(api, 'getLock'),
    health: spyOn(api, 'getMetadataHealth'),
    match: spyOn(api, 'matchLibrary'),
    ratings: spyOn(api, 'updateLibraryRatings'),
    scan: spyOn(api, 'scanLibrary'),
    quick: spyOn(api, 'quickScanLibrary'),
    cancelQuick: spyOn(api, 'cancelQuickScan'),
    inHero: spyOn(api, 'setLibraryInHero'),
    cancelRatings: spyOn(api, 'cancelLibraryRatings'),
    cancelScan: spyOn(api, 'cancelScan'),
    media: spyOn(api, 'listMedia'),
    reorder: spyOn(api, 'reorderLibraries'),
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
    spies.ratings.mockReset()
    spies.scan.mockReset()
    spies.quick.mockReset()
    spies.cancelQuick.mockReset()
    spies.inHero.mockReset()
    spies.cancelRatings.mockReset()
    spies.cancelScan.mockReset()
    spies.media.mockReset()
    spies.reorder.mockReset()
  })

  it("offers each library's history, its scans, Update ratings and Edit, each named for its library", async () => {
    spies.list.mockImplementation(async () => [library({ id: 2, name: 'Clips' })])
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    expect(await screen.findByRole('link', { name: 'History Clips' })).toHaveAttribute(
      'href',
      '/libraries/2/history',
    )
    expect(screen.getByRole('button', { name: 'Full scan Clips' })).toBeEnabled()
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
    await openAll()
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
    await openAll()
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
    await openAll()
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
    await openAll()
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
    await openAll()
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
    await openAll()
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
    await openAll()
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
    await openAll()
    const folders = await screen.findByRole('list', { name: 'Folders' })
    expect(
      within(folders)
        .getAllByRole('listitem')
        .map((item) => Array.from(item.children, (part) => part.textContent)),
    ).toEqual([
      ['/media', 'TV'],
      ['/mnt/archive', 'TV'],
    ])
  })

  it('groups the folders under one parent into a single line', async () => {
    spies.list.mockImplementation(async () => [
      library({ name: 'Shows', paths: ['/media/vermithor/TV', '/media/vermithor/Mini-Series'] }),
    ])
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    const folders = await screen.findByRole('list', { name: 'Folders' })
    const lines = within(folders).getAllByRole('listitem')
    expect(lines).toHaveLength(1)
    expect(within(lines[0]).getByText('/media/vermithor')).toBeTruthy()
    expect(within(lines[0]).getByText('TV · Mini-Series')).toBeTruthy()
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
    await openAll()
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
    expect(await pictureBehind('Films')).toContain('/api/pictures/items/7/backdrop/abc')
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
    expect(screen.queryByText('/media')).toBeNull()
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
    await openAll()
    expect(await screen.findByText('/media')).toBeInTheDocument()
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

  it('updates a library’s ratings, which asks for the titles that have none', async () => {
    const clips = library({ id: 2, name: 'Clips' })
    spies.list.mockImplementation(async () => [clips])
    spies.ratings.mockImplementation(async () =>
      library({
        id: 2,
        name: 'Clips',
        ratingsRefresh: { state: 'running', done: 0, total: 7, startedAt: ISO },
      }),
    )
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    const button = await screen.findByRole('button', { name: 'Update ratings Clips' })
    expect(button).toHaveAttribute(
      'title',
      'Find the movies and shows with no rating and fetch their ratings; needs a ratings source (TMDB, OMDb or MDBList)',
    )
    spies.list.mockImplementation(async () => [
      library({
        id: 2,
        name: 'Clips',
        ratingsRefresh: { state: 'running', done: 0, total: 7, startedAt: ISO },
      }),
    ])
    await userEvent.click(button)
    expect(spies.ratings).toHaveBeenCalledWith(2)
    expect(await screen.findByText('Updating ratings · 0 of 7')).toBeInTheDocument()
  })

  it('turns Update ratings into its own Cancel while it runs, in the same button', async () => {
    spies.list.mockImplementation(async () => [
      library({
        id: 2,
        name: 'Clips',
        ratingsRefresh: { state: 'running', done: 2, total: 7, startedAt: ISO },
      }),
    ])
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    expect(await screen.findByRole('button', { name: 'Cancel update ratings Clips' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Update ratings Clips' })).toBeNull()
  })

  it('includes a library in the hero, or leaves it out, from a checkbox on its card', async () => {
    const clips = library({ id: 2, name: 'Clips' })
    // The server's copy, which the list is read from again once the change settles.
    const stored = { current: clips }
    spies.list.mockImplementation(async () => [stored.current])
    spies.inHero.mockImplementation(async ({ inHero }) => {
      stored.current = { ...clips, settings: { ...clips.settings, inHero } }
      return stored.current
    })
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    const box = await screen.findByRole('checkbox', { name: 'Include in hero display for Clips' })
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(spies.inHero).toHaveBeenCalledWith({ id: 2, inHero: false })
    await waitFor(() => expect(box).not.toBeChecked())
  })

  it('tells what each button on a library does when it is hovered, a disabled one included', async () => {
    const films = library({
      id: 4,
      name: 'Films',
      unmatchedCount: 0,
      settings: { ...library().settings, kind: 'movies' },
    })
    spies.list.mockImplementation(async () => [films])
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    await screen.findByRole('button', { name: 'Full scan Films' })
    const actions = [
      'Pin Films',
      'Quick scan Films',
      'Full scan Films',
      'Update ratings Films',
      'Match again Films',
      'Edit Films',
    ]
    actions.forEach((name) => {
      expect(screen.getByRole('button', { name }).getAttribute('title')).toBeTruthy()
      // Each wears an icon, the Pin's included.
      expect(screen.getByRole('button', { name }).querySelector('svg')).not.toBeNull()
    })
    expect(screen.getByRole('link', { name: 'History Films' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'History Films' }).getAttribute('title')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Match again Films' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Match again Films' })).toHaveAttribute(
      'title',
      expect.stringContaining('nothing to match again'),
    )
    expect(screen.getByRole('button', { name: /^Add library/ }).getAttribute('title')).toBeTruthy()
  })

  it('keeps a locked library out of the hero: its box is off and cannot be ticked', async () => {
    const locked = library({
      id: 2,
      name: 'Tutorials',
      settings: { ...library().settings, locked: true, inHero: false },
    })
    spies.list.mockImplementation(async () => [locked])
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    const box = await screen.findByRole('checkbox', {
      name: 'Include in hero display for Tutorials',
    })
    expect(box).not.toBeChecked()
    expect(box).toBeDisabled()
    await userEvent.click(box)
    expect(spies.inHero).not.toHaveBeenCalled()
  })

  it('shows a spinner on Update ratings while it runs, and cancels it', async () => {
    const running = library({
      id: 2,
      name: 'Clips',
      ratingsRefresh: { state: 'running', done: 2, total: 7, startedAt: ISO },
    })
    spies.list.mockImplementation(async () => [running])
    spies.cancelRatings.mockImplementation(async () => library({ id: 2, name: 'Clips' }))
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    const button = await screen.findByRole('button', { name: 'Cancel update ratings Clips' })
    expect(button.querySelector('[class*="spinner"]')).not.toBeNull()
    // The button that started it is the one that cancels it: there is no second one.
    expect(screen.queryByRole('button', { name: 'Update ratings Clips' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Cancel/ })).toHaveLength(1)
    await userEvent.click(button)
    expect(spies.cancelRatings).toHaveBeenCalledWith(2)
  })

  it('shows a spinner on Full scan while a full scan runs, and cancels it', async () => {
    const scanning = library({
      id: 2,
      name: 'Clips',
      scan: { ...library().scan, state: 'indexing', found: 10, processed: 3 },
    })
    spies.list.mockImplementation(async () => [scanning])
    spies.cancelScan.mockImplementation(async () => library({ id: 2, name: 'Clips' }))
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    const button = await screen.findByRole('button', { name: 'Cancel full scan Clips' })
    expect(button).toBeEnabled()
    expect(button.querySelector('[class*="spinner"]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Full scan Clips' })).toBeNull()
    await userEvent.click(button)
    expect(spies.cancelScan).toHaveBeenCalledWith(2)
  })

  it('shows a spinner on Quick scan while a quick scan runs, and cancels it', async () => {
    const scanning = library({
      id: 2,
      name: 'Clips',
      scan: { ...library().scan, state: 'indexing', kind: 'quick', found: 10, processed: 9 },
    })
    spies.list.mockImplementation(async () => [scanning])
    spies.cancelQuick.mockImplementation(async () => library({ id: 2, name: 'Clips' }))
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    const button = await screen.findByRole('button', { name: 'Cancel quick scan Clips' })
    expect(button).toBeEnabled()
    expect(button.querySelector('[class*="spinner"]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Quick scan Clips' })).toBeNull()
    // The other scan waits, as it is, with no spinner and no Cancel of its own.
    const full = screen.getByRole('button', { name: 'Full scan Clips' })
    expect(full).toBeDisabled()
    expect(full.querySelector('[class*="spinner"]')).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Cancel/ })).toHaveLength(1)
    await userEvent.click(button)
    expect(spies.cancelQuick).toHaveBeenCalledWith(2)
  })

  it('starts a quick scan from its button, and says it is matching the new videos', async () => {
    const clips = library({ id: 2, name: 'Clips' })
    const matching = library({
      id: 2,
      name: 'Clips',
      scan: { ...clips.scan, state: 'matching', kind: 'quick', found: 12, processed: 12 },
    })
    spies.list.mockImplementation(async () => [clips])
    spies.quick.mockImplementation(async () => matching)
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    const button = await screen.findByRole('button', { name: 'Quick scan Clips' })
    // From then on the server says what the scan is doing.
    spies.list.mockImplementation(async () => [matching])
    await userEvent.click(button)
    expect(spies.quick).toHaveBeenCalledWith(2)
    expect(await screen.findByText('Matching the new videos')).toBeInTheDocument()
  })

  it('offers no Cancel while nothing runs', async () => {
    spies.list.mockImplementation(async () => [library({ id: 2, name: 'Clips' })])
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    await screen.findByRole('button', { name: 'Full scan Clips' })
    expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull()
  })

  it("says why a scan or Update ratings was refused, in the library's row", async () => {
    spies.list.mockImplementation(async () => [library({ id: 2, name: 'Clips' })])
    spies.ratings.mockRejectedValue(new Error('The server is busy'))
    spies.scan.mockRejectedValue(new Error('The folders are gone'))
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    await userEvent.click(await screen.findByRole('button', { name: 'Update ratings Clips' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not update ratings: The server is busy',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Full scan Clips' }))
    expect(
      await screen.findByText('Could not run a full scan: The folders are gone'),
    ).toBeInTheDocument()
  })

  it("reads the library's listings again when a refresh waits for the daily limit, as scores changed", async () => {
    pollFast()
    const refresh = (ratingsRefresh: Library['ratingsRefresh']) =>
      library({ id: 2, name: 'Clips', ratingsRefresh })
    // The polls after the first wait for the test, so the first read is counted before the next.
    const waiting = held<Library[]>()
    spies.list.mockImplementationOnce(async () => [
      refresh({ state: 'running', done: 2, total: 7, startedAt: ISO }),
    ])
    spies.list.mockImplementation(() => waiting.promise)
    spies.media.mockImplementation(async () => [mediaItem()])
    const Listing = () => {
      useQuery(mediaListQuery({ libraryId: 2, search: '', sort: 'title', seed: 0 }))
      return null
    }
    renderWithProviders({
      ui: (
        <>
          <LibrariesPage />
          <Listing />
        </>
      ),
    })
    await openAll()
    await screen.findByText('Updating ratings · 2 of 7')
    await waitFor(() => expect(spies.media).toHaveBeenCalledTimes(1))
    await act(async () =>
      waiting.answer([
        refresh({
          state: 'waiting',
          done: 4,
          total: 7,
          startedAt: ISO,
          reason: 'budget',
          resumesAt: '2999-01-01T00:00:00.000Z',
        }),
      ]),
    )
    await screen.findByText(/^Ratings: 4 of 7/)
    await waitFor(() => expect(spies.media.mock.calls.length).toBeGreaterThan(1))
  })

  it('shows nothing new when the answer is already idle', async () => {
    spies.list.mockImplementation(async () => [library({ id: 2, name: 'Clips' })])
    spies.ratings.mockImplementation(async () =>
      library({ id: 2, name: 'Clips', ratingsRefresh: { state: 'idle', finishedAt: ISO } }),
    )
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    await userEvent.click(await screen.findByRole('button', { name: 'Update ratings Clips' }))
    await waitFor(() => expect(spies.ratings).toHaveBeenCalled())
    expect(screen.queryByText(/^Updating ratings|^Ratings:/)).toBeNull()
  })

  it('shows a waiting refresh and why', async () => {
    spies.list.mockImplementation(async () => [
      library({
        id: 2,
        name: 'Clips',
        ratingsRefresh: {
          state: 'waiting',
          done: 5,
          total: 7,
          startedAt: ISO,
          reason: 'budget',
          resumesAt: '2999-01-01T00:00:00.000Z',
        },
      }),
    ])
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    expect(
      await screen.findByText('Ratings: 5 of 7 · the rest after midnight UTC (daily limit)'),
    ).toBeInTheDocument()
  })

  it('reads the libraries again while a refresh runs, so its count climbs', async () => {
    pollFast()
    spies.list.mockImplementation(async () => [
      library({
        id: 2,
        name: 'Clips',
        ratingsRefresh: { state: 'running', done: 2, total: 7, startedAt: ISO },
      }),
    ])
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    await screen.findByText('Updating ratings · 2 of 7')
    await waitFor(() => expect(spies.list.mock.calls.length).toBeGreaterThan(2))
  })

  it('does not read the libraries on a clock while a refresh waits, only when it resumes', async () => {
    pollFast()
    spies.list.mockImplementation(async () => [
      library({
        id: 2,
        name: 'Clips',
        ratingsRefresh: {
          state: 'waiting',
          done: 5,
          total: 7,
          startedAt: ISO,
          reason: 'unavailable',
          resumesAt: '2999-01-01T00:00:00.000Z',
        },
      }),
    ])
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    await screen.findByText('Ratings: 5 of 7 · waiting for the ratings service')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(spies.list).toHaveBeenCalledTimes(1)
  })

  it('leaves Add library and the scans and Update ratings out while the admin lock is on, but keeps the pin', async () => {
    spies.list.mockImplementation(async () => [library({ name: 'Clips' })])
    renderWithProviders({ ui: <LibrariesPage />, adminLock: { state: 'on', available: true } })
    await openAll()
    expect(await screen.findByRole('button', { name: 'Pin Clips' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add library' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Quick scan/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Full scan/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Update ratings/ })).toBeNull()
  })

  it('shows the folders only while the admin lock is off, even in a list cached with them', async () => {
    spies.list.mockImplementation(async () => [
      library({ name: 'Clips', paths: ['/media/vermithor/Clips'] }),
    ])
    renderWithProviders({ ui: <LibrariesPage />, adminLock: { state: 'on', available: true } })
    await openAll()
    expect(await screen.findByRole('button', { name: 'Pin Clips' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Folders' })).toBeNull()
    expect(screen.queryByText('/media/vermithor')).toBeNull()
    cleanup()

    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    expect(await screen.findByText('/media/vermithor')).toBeInTheDocument()
  })

  it('says how to add the first library while the admin lock is on', async () => {
    spies.list.mockImplementation(async () => [])
    renderWithProviders({ ui: <LibrariesPage />, adminLock: { state: 'on', available: true } })
    expect(
      await screen.findByText('Turn the admin lock off in Settings to add one.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add library' })).toBeNull()
  })

  it('offers Add library to the owner of a server with accounts, with no word of an admin lock', async () => {
    spies.list.mockImplementation(async () => [])
    renderWithProviders({
      ui: <LibrariesPage />,
      account: fakeAccount({ isOwner: true }),
      adminLock: null,
    })
    await waitFor(() => expect(spies.list).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Add library' })).toBeInTheDocument()
    expect(screen.queryByText(/admin lock/i)).toBeNull()
  })

  it('tells a member that only the owner can add a library, and leaves the buttons out', async () => {
    spies.list.mockImplementation(async () => [])
    renderWithProviders({ ui: <LibrariesPage />, account: fakeAccount(), adminLock: null })
    expect(await screen.findByText('Only the owner can add a library.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add library' })).toBeNull()
    expect(screen.queryByText(/admin lock/i)).toBeNull()
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
  describe('folded cards and the order', () => {
    const three = () => [
      library({ id: 1, name: 'Alpha' }),
      library({ id: 2, name: 'Bravo' }),
      library({ id: 3, name: 'Charlie' }),
    ]
    const names = () =>
      within(screen.getByRole('list'))
        .getAllByRole('listitem')

        .map((item) => item.textContent?.match(/Alpha|Bravo|Charlie/)?.[0] ?? '')

    beforeEach(() => {
      spies.reorder.mockImplementation(async () => undefined)
    })

    it('folds every card to its name and counts until it is opened, and folds it again', async () => {
      spies.list.mockImplementation(async () => three())
      renderWithProviders({ ui: <LibrariesPage /> })
      const toggle = await screen.findByRole('button', { name: 'Expand Alpha' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: 'Full scan Alpha' })).toBeNull()

      await userEvent.click(toggle)
      expect(screen.getByRole('button', { name: 'Collapse Alpha' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(screen.getByRole('button', { name: 'Full scan Alpha' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Full scan Bravo' })).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Collapse Alpha' }))
      expect(screen.queryByRole('button', { name: 'Full scan Alpha' })).toBeNull()
    })

    it('thins the cards in edit mode and opens the ones that were open again on Finish', async () => {
      spies.list.mockImplementation(async () => three())
      renderWithProviders({ ui: <LibrariesPage /> })
      await userEvent.click(await screen.findByRole('button', { name: 'Expand Bravo' }))

      await userEvent.click(screen.getByRole('button', { name: 'Edit order' }))
      expect(screen.queryByRole('button', { name: 'Full scan Bravo' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Expand / })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Add library' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Move Alpha up' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Move Charlie down' })).toBeDisabled()

      await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
      expect(screen.getByRole('button', { name: 'Full scan Bravo' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Expand Alpha' })).toBeInTheDocument()
      expect(spies.reorder).not.toHaveBeenCalled()
    })

    it('moves a library with its buttons, and saves the whole order on Finish, at once on screen', async () => {
      let kept = three()
      spies.list.mockImplementation(async () => kept)
      // The server keeps the order it is sent, as it answers the read after.
      spies.reorder.mockImplementation(async ({ ids }) => {
        kept = ids.flatMap((id) => kept.filter((each) => each.id === id))
      })
      renderWithProviders({ ui: <LibrariesPage /> })
      await userEvent.click(await screen.findByRole('button', { name: 'Edit order' }))

      await userEvent.click(screen.getByRole('button', { name: 'Move Charlie up' }))
      await userEvent.click(screen.getByRole('button', { name: 'Move Charlie up' }))
      expect(names()).toEqual(['Charlie', 'Alpha', 'Bravo'])
      expect(spies.reorder).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
      expect(spies.reorder).toHaveBeenCalledWith({ ids: [3, 1, 2] })
      expect(names()).toEqual(['Charlie', 'Alpha', 'Bravo'])
    })

    it('moves a library by dragging its line over another', async () => {
      spies.list.mockImplementation(async () => three())
      renderWithProviders({ ui: <LibrariesPage /> })
      await userEvent.click(await screen.findByRole('button', { name: 'Edit order' }))

      const lines = within(screen.getByRole('list', { name: 'Libraries, in order' })).getAllByRole(
        'listitem',
      )
      const data = new Map<string, string>()
      const dataTransfer = {
        effectAllowed: '',
        setData: (type: string, value: string) => data.set(type, value),
      }
      const [alpha, , charlie] = lines
      fireEvent.dragStart(alpha, { dataTransfer })
      fireEvent.dragOver(charlie, { dataTransfer })
      fireEvent.dragEnd(alpha, { dataTransfer })
      expect(data.get('text/plain')).toBe('1')

      await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
      expect(spies.reorder).toHaveBeenCalledWith({ ids: [2, 3, 1] })
    })

    it('saves the order when the admin leaves the page mid-edit', async () => {
      spies.list.mockImplementation(async () => three())
      const page = renderWithProviders({ ui: <LibrariesPage /> })
      await userEvent.click(await screen.findByRole('button', { name: 'Edit order' }))
      await userEvent.click(screen.getByRole('button', { name: 'Move Alpha down' }))

      page.unmount()
      await waitFor(() => expect(spies.reorder).toHaveBeenCalledWith({ ids: [2, 1, 3] }))
    })

    it('saves nothing on leaving when the order did not change', async () => {
      spies.list.mockImplementation(async () => three())
      const page = renderWithProviders({ ui: <LibrariesPage /> })
      await userEvent.click(await screen.findByRole('button', { name: 'Edit order' }))
      page.unmount()
      expect(spies.reorder).not.toHaveBeenCalled()
    })

    it('puts the order back and says why when the server refuses it', async () => {
      spies.list.mockImplementation(async () => three())
      spies.reorder.mockImplementation(async () => {
        throw new Error('ids must name every library once.')
      })
      renderWithProviders({ ui: <LibrariesPage /> })
      await userEvent.click(await screen.findByRole('button', { name: 'Edit order' }))
      await userEvent.click(screen.getByRole('button', { name: 'Move Alpha down' }))
      await userEvent.click(screen.getByRole('button', { name: 'Finish' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'ids must name every library once.',
      )
      await waitFor(() => expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie']))
    })

    it('offers no editing of the order with one library, or while the admin lock is on', async () => {
      spies.list.mockImplementation(async () => [library({ name: 'Alpha' })])
      renderWithProviders({ ui: <LibrariesPage /> })
      await screen.findByRole('button', { name: 'Expand Alpha' })
      expect(screen.queryByRole('button', { name: 'Edit order' })).toBeNull()
      cleanup()

      spies.list.mockImplementation(async () => three())
      renderWithProviders({ ui: <LibrariesPage />, adminLock: { state: 'on', available: true } })
      await screen.findByRole('button', { name: 'Expand Alpha' })
      expect(screen.queryByRole('button', { name: 'Edit order' })).toBeNull()
    })
  })
})

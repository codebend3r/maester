import { describe, expect, it, mock } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LIBRARY_ICON_NAMES, type MetadataHealth, createApiClient } from '@raven/core'
import { library, metadataHealth } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const created: unknown[] = []
/** Whether the server has a PIN, as the next dialog will find. */
const lockAvailable = { now: true }
const updated: unknown[] = []
const offline = createApiClient({
  fetch: async () => {
    throw new Error('No network in tests')
  },
})

/** What the next dialog finds of metadata: TMDB off and the AI key set, unless a test says otherwise. */
const NO_TMDB = metadataHealth({ tmdb: 'off', ai: 'ok', aiRemaining: 200 })
const served: { health: MetadataHealth } = { health: NO_TMDB }

// Spread over a real client: Bun's module mocks are shared by every test
// file, and the others still need the URL helpers.
mock.module('@/lib/api', () => ({
  api: {
    ...offline,
    browse: async (path?: string) =>
      path
        ? { path, parent: '/media', directories: [] }
        : {
            path: '/media',
            parent: null,
            directories: [{ name: 'Movies', path: '/media/Movies' }],
          },
    createLibrary: async (input: unknown) => {
      created.push(input)
      return { id: 1 }
    },
    updateLibrary: async ({ id, input }: { id: number; input: unknown }) => {
      updated.push(input)
      return { id }
    },
    getLock: async () => ({ available: lockAvailable.now, unlocked: false }),
    getMetadataHealth: async () => served.health,
  },
}))

const { LibraryDialog } = await import('@/components/LibraryDialog/LibraryDialog')

describe('LibraryDialog', () => {
  it('offers Ratings shown for a Movies library, and not for Other', async () => {
    renderWithProviders(
      <LibraryDialog
        library={library({ settings: { ...library().settings, kind: 'movies' } })}
        onClose={() => undefined}
      />,
    )
    const select = screen.getByRole('combobox', { name: 'Ratings shown' })
    expect(select).toHaveValue('tmdb')
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['TMDB', 'IMDb', 'Rotten Tomatoes', 'Metacritic'])
    await userEvent.click(screen.getByRole('radio', { name: 'Other' }))
    expect(screen.queryByRole('combobox', { name: 'Ratings shown' })).toBeNull()
  })

  it('says how to turn on posters and details while TMDB is off', async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    const type = screen.getByRole('group', { name: 'Type' })
    expect(await screen.findByText('TMDB_API_TOKEN')).toBeInTheDocument()
    expect(type).toHaveAccessibleDescription(
      "Set TMDB_API_TOKEN in raven's .env for posters and details.",
    )
  })

  it("says how to turn the AI lookup on while its key is unset, after TMDB's hint", async () => {
    served.health = { ...NO_TMDB, ai: 'off', aiRemaining: 0 }
    try {
      renderWithProviders(<LibraryDialog onClose={() => undefined} />)
      const type = screen.getByRole('group', { name: 'Type' })
      expect(await screen.findByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
      expect(type).toHaveAccessibleDescription(
        "Set TMDB_API_TOKEN in raven's .env for posters and details. Set ANTHROPIC_API_KEY in raven's .env to look up titles the matcher misses.",
      )
    } finally {
      served.health = NO_TMDB
    }
  })

  it('names only the AI key once TMDB is set', async () => {
    served.health = { ...NO_TMDB, tmdb: 'ok', ai: 'off', aiRemaining: 0 }
    try {
      renderWithProviders(<LibraryDialog onClose={() => undefined} />)
      const type = screen.getByRole('group', { name: 'Type' })
      expect(await screen.findByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
      expect(type).toHaveAccessibleDescription(
        "Movies, TV shows, anime, family, documentaries and sporting events get posters and details from TMDB. Set ANTHROPIC_API_KEY in raven's .env to look up titles the matcher misses.",
      )
    } finally {
      served.health = NO_TMDB
    }
  })

  it('shows every problem before sending anything', async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add library' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Give the library a name.')
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one folder.')
    expect(created).toEqual([])
  })

  it('adds a folder picked in the browser and creates the library', async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Movies')
    await userEvent.click(await screen.findByRole('button', { name: 'Movies' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Use this folder' }))
    expect(screen.getByRole('button', { name: 'Remove /media/Movies' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add library' }))
    expect(created).toEqual([
      {
        name: 'Movies',
        paths: ['/media/Movies'],
        settings: {
          saveProgress: true,
          pinned: true,
          sort: 'title',
          view: 'grid',
          groupBy: 'resolution',
          watchedPercent: 90,
          kind: 'other',
          ratingsSource: 'tmdb',
          autoRefresh: true,
          locked: false,
          folderLayout: 'auto',
          icon: null,
        },
      },
    ])
  })

  it('sends the settings as they are ticked', async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Clips')
    await userEvent.type(screen.getByLabelText('Folder path'), '/media/Clips')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Save where each video stopped' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Refresh automatically' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Lock with the PIN' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add library' }))
    expect(created.at(-1)).toEqual({
      name: 'Clips',
      paths: ['/media/Clips'],
      settings: {
        saveProgress: false,
        pinned: true,
        sort: 'title',
        view: 'grid',
        groupBy: 'resolution',
        watchedPercent: 90,
        kind: 'other',
        ratingsSource: 'tmdb',
        autoRefresh: false,
        locked: true,
        folderLayout: 'auto',
        icon: null,
      },
    })
  })

  it('makes a library of the type chosen', async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    expect(screen.getByRole('radio', { name: 'Other' })).toBeChecked()
    await userEvent.type(screen.getByLabelText('Name'), 'Shows')
    await userEvent.type(screen.getByLabelText('Folder path'), '/media/Shows')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('radio', { name: 'TV shows' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add library' }))
    expect(created.at(-1)).toMatchObject({
      settings: { kind: 'shows', view: 'grid', groupBy: 'resolution' },
    })
  })

  it('starts a Movies library grouped into matched and not', async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Films')
    await userEvent.type(screen.getByLabelText('Folder path'), '/media/Films')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Movies' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add library' }))
    expect(created.at(-1)).toMatchObject({
      settings: { kind: 'movies', view: 'grouped', groupBy: 'match' },
    })
  })

  it('swaps a grouping the new type cannot show when an edited library changes type', async () => {
    renderWithProviders(
      <LibraryDialog
        library={library({
          settings: { ...library().settings, kind: 'movies', view: 'grouped', groupBy: 'match' },
        })}
        onClose={() => undefined}
      />,
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Other' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updated.at(-1)).toMatchObject({
      settings: { kind: 'other', view: 'grouped', groupBy: 'resolution' },
    })
  })

  it('offers every type, each matched like its counterpart', async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    expect(
      within(screen.getByRole('group', { name: 'Type' }))
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value')),
    ).toEqual([
      'movies',
      'shows',
      'animeMovies',
      'animeShows',
      'familyMovies',
      'familyShows',
      'documentaries',
      'sports',
      'youtube',
      'other',
    ])
    await userEvent.type(screen.getByLabelText('Name'), 'Anime')
    await userEvent.type(screen.getByLabelText('Folder path'), '/media/Anime')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Anime movies' }))
    expect(screen.getByRole('combobox', { name: 'Ratings shown' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Sporting events' }))
    expect(screen.getByRole('combobox', { name: 'Ratings shown' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'YouTube videos' }))
    expect(screen.queryByRole('combobox', { name: 'Ratings shown' })).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'Anime shows' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add library' }))
    expect(created.at(-1)).toMatchObject({
      settings: { kind: 'animeShows', view: 'grid', groupBy: 'resolution' },
    })
  })

  it('locks a library of any type, and keeps the lock through a change of type', async () => {
    renderWithProviders(
      <LibraryDialog
        library={library({ settings: { ...library().settings, kind: 'movies' } })}
        onClose={() => undefined}
      />,
    )
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Lock with the PIN' }))
    await userEvent.click(screen.getByRole('radio', { name: 'YouTube videos' }))
    expect(screen.getByRole('checkbox', { name: 'Lock with the PIN' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Anime shows' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updated.at(-1)).toMatchObject({ settings: { kind: 'animeShows', locked: true } })
  })

  it("shows the library's own type when editing it", () => {
    renderWithProviders(
      <LibraryDialog
        library={library({ settings: { ...library().settings, kind: 'movies' } })}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Movies' })).toBeChecked()
  })

  it("offers every icon, the type's own checked until another is picked", async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    const icons = within(screen.getByRole('group', { name: 'Icon' })).getAllByRole('radio')
    expect(icons.map((radio) => radio.getAttribute('value'))).toEqual([...LIBRARY_ICON_NAMES])
    expect(icons).toHaveLength(24)
    expect(screen.getByRole('radio', { name: 'Home videos icon' })).toBeChecked()
    await userEvent.type(screen.getByLabelText('Name'), 'UFC')
    await userEvent.type(screen.getByLabelText('Folder path'), '/media/UFC')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Sporting events' }))
    expect(screen.getByRole('radio', { name: 'Sporting events icon' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'UFC icon' }))
    expect(screen.getByRole('radio', { name: 'UFC icon' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Movies' }))
    expect(screen.getByRole('radio', { name: 'UFC icon' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Add library' }))
    expect(created.at(-1)).toMatchObject({ settings: { kind: 'movies', icon: 'octagon' } })
  })

  it("keeps the icon picked, the type's own included, through a change of type", async () => {
    renderWithProviders(
      <LibraryDialog
        library={library({ settings: { ...library().settings, kind: 'sports', icon: 'octagon' } })}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByRole('radio', { name: 'UFC icon' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Sporting events icon' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Movies' }))
    expect(screen.getByRole('radio', { name: 'Sporting events icon' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updated.at(-1)).toMatchObject({ settings: { kind: 'movies', icon: 'trophy' } })
  })

  it("wears the type's icon, changing with the type, until one is picked", async () => {
    renderWithProviders(
      <LibraryDialog
        library={library({ settings: { ...library().settings, kind: 'sports' } })}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Sporting events icon' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Movies' }))
    expect(screen.getByRole('radio', { name: 'Movies icon' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updated.at(-1)).toMatchObject({ settings: { kind: 'movies', icon: null } })
  })

  it('sets how far into a video counts as watched', async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Clips')
    await userEvent.type(screen.getByLabelText('Folder path'), '/media/Clips')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    const watched = screen.getByRole('spinbutton', { name: 'Watched at' })
    expect(watched).toHaveValue(90)
    await userEvent.clear(watched)
    await userEvent.type(watched, '75')
    await userEvent.click(screen.getByRole('button', { name: 'Add library' }))
    expect(created.at(-1)).toMatchObject({ settings: { watchedPercent: 75 } })
  })

  it('will not count less than 1% or more than 100% as watched', async () => {
    renderWithProviders(<LibraryDialog library={library()} onClose={() => undefined} />)
    const watched = screen.getByRole('spinbutton', { name: 'Watched at' })
    await userEvent.clear(watched)
    await userEvent.type(watched, '150')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Watched at must be a whole percentage from 1 to 100.',
    )
  })

  it("shows the library's own settings when editing it", () => {
    renderWithProviders(
      <LibraryDialog
        library={library({
          settings: { ...library().settings, saveProgress: false, autoRefresh: false },
        })}
        onClose={() => undefined}
      />,
    )
    expect(
      screen.getByRole('checkbox', { name: 'Save where each video stopped' }),
    ).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Pin to the side menu' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Refresh automatically' })).not.toBeChecked()
  })

  it("shows the library's own watched percentage when editing it", () => {
    renderWithProviders(
      <LibraryDialog
        library={library({ settings: { ...library().settings, watchedPercent: 60 } })}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByRole('spinbutton', { name: 'Watched at' })).toHaveValue(60)
  })

  it('cannot lock a library until the server has a PIN', async () => {
    lockAvailable.now = false
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    expect(await screen.findByText(/to lock a library/, { selector: 'p' })).toHaveTextContent(
      "Set LIBRARY_PIN in raven's .env to lock a library.",
    )
    expect(screen.getByRole('checkbox', { name: 'Lock with the PIN' })).toBeDisabled()
    lockAvailable.now = true
  })

  it('cannot lock a library while the admin lock is on', async () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />, {
      adminLock: { state: 'on', available: true },
    })
    expect(await screen.findByText(/to lock a library/, { selector: 'p' })).toHaveTextContent(
      'Turn the admin lock off in Settings to lock a library.',
    )
    expect(screen.getByRole('checkbox', { name: 'Lock with the PIN' })).toBeDisabled()
  })

  it('reads letter and group folders unless told not to', async () => {
    renderWithProviders(
      <LibraryDialog
        library={library({ settings: { ...library().settings, kind: 'animeShows' } })}
        onClose={() => undefined}
      />,
    )
    const box = screen.getByRole('checkbox', { name: 'Read letter and group folders' })
    expect(box).toBeChecked()
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updated.at(-1)).toMatchObject({ settings: { folderLayout: 'flat' } })
  })

  it('says what each path was read as', () => {
    renderWithProviders(
      <LibraryDialog
        library={library({
          paths: ['/media/Anime', '/media/Classics'],
          layouts: [
            { path: '/media/Anime', layout: 'lettered', groups: 23 },
            { path: '/media/Classics', layout: 'flat', groups: 0 },
          ],
          settings: { ...library().settings, kind: 'animeShows' },
        })}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText('/media/Anime: letter folders (23)')).toBeTruthy()
    expect(screen.getByText('/media/Classics: one folder per title')).toBeTruthy()
  })

  it('offers no folder layout for a library that is never matched', () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    expect(screen.queryByRole('checkbox', { name: 'Read letter and group folders' })).toBeNull()
  })
})

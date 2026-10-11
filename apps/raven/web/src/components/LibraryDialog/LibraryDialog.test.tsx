import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createApiClient } from '@raven/core'
import { library } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const created: unknown[] = []
const offline = createApiClient({
  fetch: async () => {
    throw new Error('No network in tests')
  },
})

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
  },
}))

const { LibraryDialog } = await import('@/components/LibraryDialog/LibraryDialog')

describe('LibraryDialog', () => {
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
    expect(created.at(-1)).toMatchObject({ settings: { kind: 'shows' } })
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
        library={library({ settings: { ...library().settings, saveProgress: false } })}
        onClose={() => undefined}
      />,
    )
    expect(
      screen.getByRole('checkbox', { name: 'Save where each video stopped' }),
    ).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Pin to the side menu' })).toBeChecked()
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
})

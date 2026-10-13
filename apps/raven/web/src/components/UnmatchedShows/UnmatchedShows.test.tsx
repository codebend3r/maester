import { describe, expect, it, mock } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createApiClient } from '@raven/core'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const offline = createApiClient({
  fetch: async () => {
    throw new Error('No network in tests')
  },
})
const matched: Array<{ mediaId: number; tmdbId: string | null }> = []

// Spread over a real client: Bun's module mocks are shared by every test
// file, and the others still need the URL helpers.
mock.module('@/lib/api', () => ({
  api: {
    ...offline,
    searchMatches: async () => [],
    setMatch: async (request: { mediaId: number; tmdbId: string | null }) => {
      matched.push(request)
      return mediaItem()
    },
  },
}))

const { UnmatchedShows } = await import('@/components/UnmatchedShows/UnmatchedShows')

const files = [
  mediaItem({ id: 1, title: 'Ep 1', folder: 'Archie/Season 1', fileName: 'Archie - S01E01.mkv' }),
  mediaItem({ id: 2, title: 'Ep 2', folder: 'Archie/Season 1', fileName: 'Archie - S01E02.mkv' }),
  mediaItem({ id: 3, title: 'Ep 3', folder: 'Veronica', fileName: 'Veronica - S01E01.mkv' }),
]

const renderShows = () =>
  renderWithProviders(
    <UnmatchedShows
      files={files}
      renderFiles={(group) => (
        <ul aria-label="Episodes">
          {group.map((file) => (
            <li key={file.id}>{file.title}</li>
          ))}
        </ul>
      )}
    />,
  )

describe('UnmatchedShows', () => {
  it('lists one collapsed entry per show folder, with its episode count', () => {
    renderShows()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    const archie = screen.getByRole('button', { name: /^Archie/ })
    expect(archie).toHaveAttribute('aria-expanded', 'false')
    expect(archie).toHaveTextContent('2 episodes')
    expect(screen.getByRole('button', { name: /^Veronica/ })).toHaveTextContent('1 episode')
    expect(screen.queryByText('Ep 1')).toBeNull()
  })

  it('expands in place to its files and collapses again', async () => {
    renderShows()
    const archie = screen.getByRole('button', { name: /^Archie/ })
    await userEvent.click(archie)
    expect(archie).toHaveAttribute('aria-expanded', 'true')
    const region = screen.getByRole('region', { name: 'Archie' })
    expect(archie).toHaveAttribute('aria-controls', region.id)
    expect(within(region).getByText('Ep 1')).toBeInTheDocument()
    expect(within(region).getByText('Ep 2')).toBeInTheDocument()
    expect(screen.queryByText('Ep 3')).toBeNull()
    await userEvent.click(archie)
    expect(archie).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Ep 1')).toBeNull()
  })

  it('opens Fix match for the show, pointing its first file at the choice', async () => {
    renderShows()
    await userEvent.click(screen.getByRole('button', { name: 'Fix match for Archie' }))
    expect(await screen.findByRole('heading', { name: 'Fix match' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Title' })).toHaveValue('Archie')
    await userEvent.click(screen.getByRole('button', { name: 'Not a show' }))
    expect(matched).toEqual([{ mediaId: 1, tmdbId: null }])
  })

  it('returns focus to Fix match once its dialog is cancelled', async () => {
    renderShows()
    const fix = screen.getByRole('button', { name: 'Fix match for Archie' })
    await userEvent.click(fix)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fix).toHaveFocus()
  })

  it('names a show read from no name by its first file', () => {
    renderWithProviders(
      <UnmatchedShows
        files={[mediaItem({ id: 9, title: 'S01E02', folder: 'Season 1', fileName: 'S01E02.mkv' })]}
        renderFiles={() => null}
      />,
    )
    expect(screen.getByRole('button', { name: 'Fix match for S01E02' })).toBeInTheDocument()
  })
})

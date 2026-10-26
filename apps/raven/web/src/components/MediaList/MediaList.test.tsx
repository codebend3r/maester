import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MediaList } from '@/components/MediaList/MediaList'
import { POSTER_SIZES } from '@/lib/posters'
import { itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { reported } from '@/test/viewport'

describe('MediaList', () => {
  it('lays each video out as a row of its facts under named columns', () => {
    renderWithProviders({ ui: <MediaList items={[mediaItem()]} /> })
    const table = screen.getByRole('table', { name: 'Videos' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Title', 'Length', 'Resolution', 'Size', 'Bitrate', 'Added', 'Changed', 'Actions'])
    const [, row] = within(table).getAllByRole('row')
    if (!row) throw new Error('no data row')
    expect(within(row).getByRole('link', { name: 'Busboys (2026)' })).toHaveAttribute(
      'href',
      '/watch/7',
    )
    const cells = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent)
    expect(cells.slice(0, 4)).toEqual(['1h 37m', '1080p', '1.6 GB', '2.2 Mb/s'])
    expect(cells[4]).toContain('2026')
  })

  it('gives each rating its own column in a Movies library, and sorts on a header click', async () => {
    type RatedProps = {
      id: number
      title: string
      imdb: number | null
      tmdb: number
    }

    const rated = ({ id, title, imdb, tmdb }: RatedProps) =>
      matchedMovie({
        id,
        title,
        item: itemSummary({
          id,
          title,
          ratings: [
            ...(imdb == null
              ? []
              : [{ source: 'imdb' as const, kind: 'audience' as const, value: imdb, votes: 1 }]),
            { source: 'tmdb', kind: 'audience', value: tmdb, votes: 1 },
          ],
        }),
      })
    renderWithProviders({
      ui: (
        <MediaList
          movies
          items={[
            rated({ id: 1, title: 'Low', imdb: 6.1, tmdb: 7 }),
            rated({ id: 2, title: 'None', imdb: null, tmdb: 9 }),
            rated({ id: 3, title: 'High', imdb: 8.8, tmdb: 5 }),
          ]}
        />
      ),
    })
    const table = screen.getByRole('table', { name: 'Videos' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Title',
      'RT',
      'IMDb',
      'Metacritic',
      'TMDB',
      'Length',
      'Resolution',
      'Size',
      'Bitrate',
      'Added',
      'Released',
      'Actions',
    ])
    const titles = () =>
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent)
    expect(titles()).toEqual(['Low', 'None', 'High'])
    await userEvent.click(within(table).getByRole('button', { name: 'IMDb' }))
    expect(titles()).toEqual(['High', 'Low', 'None'])
    expect(within(table).getByRole('columnheader', { name: 'IMDb' })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    await userEvent.click(within(table).getByRole('button', { name: 'IMDb' }))
    expect(titles()).toEqual(['Low', 'High', 'None'])
    await userEvent.click(within(table).getByRole('button', { name: 'IMDb' }))
    expect(titles()).toEqual(['Low', 'None', 'High'])
  })

  it('gives each row a small poster in a Movies library, a frame grab elsewhere, out of the tab order', async () => {
    const movies = renderWithProviders({ ui: <MediaList movies items={[matchedMovie()]} /> })
    await reported()
    const poster = movies.container.querySelector('tbody img')
    expect(poster).toHaveAttribute('src', '/api/pictures/items/40/poster/p1')
    expect(poster).toHaveAttribute('sizes', POSTER_SIZES.list)
    expect(poster?.closest('a')).toHaveAttribute('tabindex', '-1')
    movies.unmount()
    const files = renderWithProviders({ ui: <MediaList items={[mediaItem()]} /> })
    await reported()
    expect(files.container.querySelector('tbody img')).toHaveAttribute(
      'src',
      '/api/media/7/thumbnail?v=1',
    )
  })

  it('leaves the facts of an unprobed video blank rather than guessing', () => {
    renderWithProviders({
      ui: (
        <MediaList
          items={[mediaItem({ duration: null, width: null, height: null, bitrate: null })]}
        />
      ),
    })
    const [, row] = screen.getAllByRole('row')
    if (!row) throw new Error('no data row')
    const cells = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent)
    expect(cells.slice(0, 4)).toEqual(['', '', '1.6 GB', ''])
  })

  it('shows the check in the title cell of a watched video, and leaves the header alone', () => {
    renderWithProviders({
      ui: <MediaList items={[mediaItem({ watched: true }), mediaItem({ id: 8 })]} />,
    })
    const [header, watched, unwatched] = screen.getAllByRole('row')
    if (!header || !watched || !unwatched) throw new Error('rows missing')
    expect(within(watched).getByRole('rowheader')).toHaveTextContent('Watched')
    expect(within(unwatched).queryByText('Watched')).toBeNull()
    expect(within(header).queryByText('Watched')).toBeNull()
  })

  it('replaces Changed with the release date in a Movies library, the year when TMDB gave no day, and sorts by it', async () => {
    type MovieProps = {
      id: number
      title: string
      released: string | null
      year: number | null
    }

    const movie = ({ id, title, released, year }: MovieProps) =>
      mediaItem({ id, title, year, item: itemSummary({ id, title, year, released }) })
    renderWithProviders({
      ui: (
        <MediaList
          movies
          items={[
            movie({ id: 1, title: 'Older', released: '1999-03-31', year: 1999 }),
            movie({ id: 2, title: 'Newer', released: '2024-11-05', year: 2024 }),
            movie({ id: 3, title: 'Dayless', released: null, year: 2001 }),
          ]}
        />
      ),
    })
    const table = screen.getByRole('table', { name: 'Videos' })
    expect(within(table).queryByRole('columnheader', { name: 'Changed' })).toBeNull()
    const rows = () => within(table).getAllByRole('row').slice(1)
    expect(within(rows()[0]!).getByText('Mar 31, 1999')).toBeInTheDocument()
    expect(within(rows()[2]!).getAllByText('2001').length).toBeGreaterThan(0)

    await userEvent.click(within(table).getByRole('button', { name: 'Released' }))
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Newer', 'Dayless', 'Older'])
  })

  it('sorts the release column by year while the server sends no release dates', async () => {
    type Movie2Props = { id: number; title: string; year: number }

    const movie = ({ id, title, year }: Movie2Props) =>
      mediaItem({ id, title, year, item: itemSummary({ id, title, year, released: undefined }) })
    renderWithProviders({
      ui: (
        <MediaList
          movies
          items={[
            movie({ id: 1, title: 'Middle', year: 2001 }),
            movie({ id: 2, title: 'Oldest', year: 1966 }),
            movie({ id: 3, title: 'Newest', year: 2026 }),
          ]}
        />
      ),
    })
    const table = screen.getByRole('table', { name: 'Videos' })
    await userEvent.click(within(table).getByRole('button', { name: 'Released' }))
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Newest', 'Middle', 'Oldest'])
  })
})

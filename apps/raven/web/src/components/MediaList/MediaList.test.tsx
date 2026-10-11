import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { MediaList } from '@/components/MediaList/MediaList'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('MediaList', () => {
  it('lays each video out as a row of its facts under named columns', () => {
    renderWithProviders(<MediaList items={[mediaItem()]} />)
    const table = screen.getByRole('table', { name: 'Videos' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Title', 'Length', 'Resolution', 'Size', 'Bitrate', 'Added', 'Actions'])
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

  it('leaves the facts of an unprobed video blank rather than guessing', () => {
    renderWithProviders(
      <MediaList
        items={[mediaItem({ duration: null, width: null, height: null, bitrate: null })]}
      />,
    )
    const [, row] = screen.getAllByRole('row')
    if (!row) throw new Error('no data row')
    const cells = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent)
    expect(cells.slice(0, 4)).toEqual(['', '', '1.6 GB', ''])
  })
})

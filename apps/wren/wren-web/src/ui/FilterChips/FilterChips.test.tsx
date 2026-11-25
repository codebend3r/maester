import { describe, expect, it, mock } from 'bun:test'
import { SEARCH_COPY } from '@raven/wren'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterChips } from '@/ui/FilterChips/FilterChips'

const CHIPS = [
  { key: 'all', label: SEARCH_COPY.all },
  { key: 'songs', label: SEARCH_COPY.songs },
  { key: 'albums', label: SEARCH_COPY.albums },
] as const

describe('FilterChips', () => {
  it('is a named set of chips, the one narrowing the list picked', () => {
    render(
      <FilterChips
        choices={CHIPS}
        label={SEARCH_COPY.filters}
        onSelect={() => undefined}
        selected="songs"
      />,
    )
    const group = screen.getByRole('radiogroup', { name: SEARCH_COPY.filters })

    expect(within(group).getAllByRole('radio')).toHaveLength(CHIPS.length)
    expect(screen.getByRole('radio', { name: SEARCH_COPY.songs })).toBeChecked()
    expect(screen.getByRole('radio', { name: SEARCH_COPY.all })).not.toBeChecked()
  })

  it('tells the screen which chip was pressed', async () => {
    const onSelect = mock()
    render(
      <FilterChips
        choices={CHIPS}
        label={SEARCH_COPY.filters}
        onSelect={onSelect}
        selected="all"
      />,
    )

    await userEvent.click(screen.getByRole('radio', { name: SEARCH_COPY.albums }))

    expect(onSelect).toHaveBeenCalledWith('albums')
  })
})

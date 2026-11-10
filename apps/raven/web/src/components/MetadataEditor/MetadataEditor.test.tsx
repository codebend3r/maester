import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ItemMetadataState } from '@raven/core'
import { MetadataEditor } from '@/components/MetadataEditor/MetadataEditor'
import { api } from '@/lib/api'
import { itemDetails, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const STATE: ItemMetadataState = {
  shown: {
    title: 'Heat',
    year: 1995,
    tagline: 'A Los Angeles crime saga',
    summary: null,
    contentRating: 'R',
  },
  original: {
    title: 'Heat',
    year: 1995,
    tagline: 'A Los Angeles crime saga',
    summary: null,
    contentRating: 'R',
  },
  overridden: [],
}

describe('MetadataEditor', () => {
  const spies = {
    state: spyOn(api, 'getItemMetadata'),
    save: spyOn(api, 'setItemMetadata'),
  }
  const done = { count: 0 }

  const open = (edition: string | null = 'Extended Cut') => {
    spies.state.mockImplementation(async () => STATE)
    spies.save.mockImplementation(async () => itemDetails({ title: 'Heat (Extended Cut)' }))
    renderWithProviders({
      ui: (
        <MetadataEditor
          details={itemDetails({
            versions: [matchedMovie({ id: 1, edition }), matchedMovie({ id: 2, edition: null })],
          })}
          itemKind="movie"
          onDone={() => {
            done.count += 1
          }}
        />
      ),
    })
  }

  afterEach(() => {
    cleanup()
    spies.state.mockReset()
    spies.save.mockReset()
    done.count = 0
  })

  it("lists the movie's files above its fields, with one Split apart for them", async () => {
    open()
    expect(await screen.findByRole('heading', { name: '2 files' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Split apart' })).toHaveLength(1)
  })

  it('shows the title and year with what TMDB says beneath them', async () => {
    open()
    expect(await screen.findByLabelText('Title')).toHaveValue('Heat')
    expect(screen.getByLabelText('Year')).toHaveValue(1995)
    expect(screen.getByText('TMDB: Heat')).toBeInTheDocument()
    expect(screen.getByText('TMDB: 1995')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use TMDB’s' })).toBeNull()
  })

  it('shows the rating, tagline and summary as words, with no box to type in', async () => {
    open()
    await screen.findByLabelText('Title')
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('spinbutton')).toHaveValue(1995)
    expect(screen.getByText('Content rating')).toBeInTheDocument()
    expect(screen.getByText('R')).toBeInTheDocument()
    expect(screen.getByText('A Los Angeles crime saga')).toBeInTheDocument()
    expect(screen.getByText('nothing')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tagline')).toBeNull()
    expect(screen.queryByText(/^TMDB: A Los Angeles/)).toBeNull()
  })

  it('puts the file name’s edition after the title with the wand, and sends the title and year alone', async () => {
    open()
    await screen.findByLabelText('Title')
    await userEvent.click(
      screen.getByRole('button', { name: 'Add the edition from the file name: Extended Cut' }),
    )
    expect(screen.getByLabelText('Title')).toHaveValue('Heat (Extended Cut)')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spies.save).toHaveBeenCalledTimes(1))
    expect(spies.save.mock.calls[0]?.[0]).toEqual({
      id: 40,
      change: { title: 'Heat (Extended Cut)', year: null },
    })
    await waitFor(() => expect(done.count).toBe(1))
  })

  it('sends an emptied year as 0, so TMDB’s does not come back', async () => {
    open()
    await screen.findByLabelText('Title')
    await userEvent.clear(screen.getByLabelText('Year'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spies.save).toHaveBeenCalledTimes(1))
    expect(spies.save.mock.calls[0]?.[0]).toEqual({ id: 40, change: { title: null, year: 0 } })
  })

  it('saves nothing with the title emptied', async () => {
    open()
    await userEvent.clear(await screen.findByLabelText('Title'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(spies.save).not.toHaveBeenCalled()
  })

  it('offers no wand without an edition, and Use TMDB’s puts a field back', async () => {
    open(null)
    const title = await screen.findByLabelText('Title')
    expect(screen.queryByRole('button', { name: /Add the edition/ })).toBeNull()
    await userEvent.clear(title)
    await userEvent.type(title, 'Heat 2')
    await userEvent.click(screen.getByRole('button', { name: 'Use TMDB’s' }))
    expect(title).toHaveValue('Heat')
  })
})

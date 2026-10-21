import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  type AiMatch,
  MATCH_SUBJECT_KINDS,
  type MatchItemType,
  type MatchSubject,
  type MediaItem,
} from '@raven/core'
import { useState } from 'react'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { api } from '@/lib/api'
import { itemDetails, itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const Harness = ({
  media,
  onMatched,
  aiMatch = null,
  matchType = 'movie',
}: {
  media: MediaItem
  onMatched: (media: MediaItem) => void
  aiMatch?: AiMatch | null
  matchType?: MatchItemType
}) => {
  const [open, setOpen] = useState(false)
  return (
    <MediaMenu
      media={media}
      open={open}
      onOpenChange={setOpen}
      matchType={matchType}
      onMatched={onMatched}
      aiMatch={aiMatch}
    />
  )
}

describe('Fix match', () => {
  const spies = {
    item: spyOn(api, 'getItem'),
    search: spyOn(api, 'searchMatches'),
    setMatch: spyOn(api, 'setMatch'),
    // The menu reads the libraries, to know which are locked; matching reads them again.
    libraries: spyOn(api, 'listLibraries').mockImplementation(async () => []),
  }

  afterEach(() => {
    cleanup()
    spies.item.mockReset()
    spies.search.mockReset()
    spies.setMatch.mockReset()
  })

  // The libraries answer holds for the whole file; a later file reads its own.
  afterAll(() => Object.values(spies).forEach((spy) => spy.mockRestore()))

  const unmatched = mediaItem({ title: 'Busboys', year: 2026, match: 'unmatched' })

  const candidate = ({
    tmdbId,
    year,
    confidence,
    poster = null,
  }: {
    tmdbId: string
    year: number
    confidence: number
    poster?: string | null
  }) => ({ tmdbId, title: 'Busboys', year, overview: null, poster, confidence })

  const openWith = async (candidates: ReturnType<typeof candidate>[]) => {
    spies.search.mockImplementation(async () => candidates)
    renderWithProviders({ ui: <Harness media={unmatched} onMatched={() => {}} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    await screen.findByRole('button', { name: `Choose Busboys (${candidates[0]?.year})` })
    return within(screen.getByRole('region', { name: 'Results' })).getAllByRole('listitem')
  }

  it('stamps each result with its confidence and names its tier, the Strong top one the best match', async () => {
    const rows = await openWith([
      candidate({ tmdbId: '1', year: 2026, confidence: 94, poster: '/b.jpg' }),
      candidate({ tmdbId: '2', year: 2016, confidence: 82 }),
      candidate({ tmdbId: '3', year: 1998, confidence: 71 }),
      candidate({ tmdbId: '4', year: 1990, confidence: 38 }),
    ])
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Best match'),
      expect.stringContaining('Strong match'),
      expect.stringContaining('Possible match'),
      expect.stringContaining('Weak match'),
    ])
    const numbers = ['94', '82', '71', '38']
    expect(
      rows.map((row, index) => within(row).getByText(numbers[index] ?? '').textContent),
    ).toEqual(numbers)
    expect(screen.getAllByText('Best match')).toHaveLength(1)
  })

  it('names no best match when the top result is not Strong', async () => {
    await openWith([
      candidate({ tmdbId: '1', year: 2026, confidence: 79 }),
      candidate({ tmdbId: '2', year: 2016, confidence: 79 }),
    ])
    expect(screen.queryByText('Best match')).toBeNull()
    expect(screen.getAllByText('Possible match')).toHaveLength(2)
  })

  it('describes each Choose by its confidence, so a screen reader hears it with the title', async () => {
    await openWith([
      candidate({ tmdbId: '1', year: 2026, confidence: 94 }),
      candidate({ tmdbId: '2', year: 1998, confidence: 38 }),
    ])
    expect(
      screen.getByRole('button', { name: 'Choose Busboys (2026)' }),
    ).toHaveAccessibleDescription(/Best match.*confidence 94 out of 100/)
    expect(
      screen.getByRole('button', { name: 'Choose Busboys (1998)' }),
    ).toHaveAccessibleDescription(/Weak match.*confidence 38 out of 100/)
  })

  it('searches with the parsed title and year, and points the file at the choice', async () => {
    const searched: Array<{
      query: string
      year?: number | null
      libraryId?: number | null
      subject?: MatchSubject | null
    }> = []
    spies.search.mockImplementation(async (request) => {
      searched.push({
        query: request.query,
        year: request.year,
        libraryId: request.libraryId,
        subject: request.subject,
      })
      return [
        {
          tmdbId: '1001',
          title: 'Busboys',
          year: 2026,
          overview: 'Two busboys.',
          poster: '/b.jpg',
          confidence: 90,
        },
        {
          tmdbId: '1002',
          title: 'Busboys',
          year: 1998,
          overview: null,
          poster: null,
          confidence: 80,
        },
      ]
    })
    const chosen: Array<string | null> = []
    spies.setMatch.mockImplementation(async ({ tmdbId }) => {
      chosen.push(tmdbId)
      return matchedMovie({ match: 'manual' })
    })
    const matched: MediaItem[] = []
    renderWithProviders({
      ui: <Harness media={unmatched} onMatched={(media) => matched.push(media)} />,
    })

    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    expect(screen.getByRole('searchbox', { name: 'Title' })).toHaveValue('Busboys')
    expect(screen.getByRole('textbox', { name: 'Year' })).toHaveValue('2026')
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Busboys (1998)' }))

    expect(searched).toEqual([
      {
        query: 'Busboys',
        year: 2026,
        libraryId: unmatched.libraryId,
        subject: { kind: 'media', id: unmatched.id },
      },
    ])
    expect(chosen).toEqual(['1002'])
    expect(matched.map((media) => media.match)).toEqual(['manual'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('searches again once the viewer stops typing, never on each keystroke', async () => {
    const searched: string[] = []
    const subjects: Array<MatchSubject | null | undefined> = []
    spies.search.mockImplementation(async (request) => {
      searched.push(`${request.query}|${request.year ?? ''}`)
      subjects.push(request.subject)
      return []
    })
    renderWithProviders({ ui: <Harness media={unmatched} onMatched={() => undefined} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    await screen.findByText(/TMDB has nothing by that name/)
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Title' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Title' }), 'Bus Boys')
    await waitFor(() => expect(searched).toEqual(['Busboys|2026', 'Bus Boys|2026']))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Year' }))
    await waitFor(() => expect(searched).toEqual(['Busboys|2026', 'Bus Boys|2026', 'Bus Boys|']))
    expect(
      subjects.every(
        (each) => each?.kind === MATCH_SUBJECT_KINDS.media && each.id === unmatched.id,
      ),
    ).toBe(true)
  })

  it('searches at once with the Search button, without waiting for typing to pause', async () => {
    const searched: string[] = []
    spies.search.mockImplementation(async (request) => {
      searched.push(`${request.query}|${request.year ?? ''}`)
      return []
    })
    renderWithProviders({ ui: <Harness media={unmatched} onMatched={() => undefined} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    await screen.findByText(/TMDB has nothing by that name/)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Title' }), ' Two')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(searched).toEqual(['Busboys|2026', 'Busboys Two|2026']))
  })

  it('says a file is not a movie at all', async () => {
    spies.search.mockImplementation(async () => [])
    const chosen: Array<string | null> = []
    spies.setMatch.mockImplementation(async ({ tmdbId }) => {
      chosen.push(tmdbId)
      return { ...unmatched, match: 'unmatched' }
    })
    renderWithProviders({ ui: <Harness media={unmatched} onMatched={() => undefined} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    await userEvent.click(screen.getByRole('button', { name: 'Not a movie' }))
    expect(chosen).toEqual([null])
  })

  it('offers Refresh details only once a file is matched', async () => {
    renderWithProviders({
      ui: <Harness media={matchedMovie({ item: itemSummary() })} onMatched={() => undefined} />,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    expect(screen.getByRole('menuitem', { name: 'Refresh details' })).toBeInTheDocument()
  })

  it('offers neither in a library that does not match its files', async () => {
    renderWithProviders({
      ui: <MediaMenu media={mediaItem()} open onOpenChange={() => undefined} />,
    })
    expect(screen.queryByRole('menuitem', { name: 'Fix match' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Refresh details' })).toBeNull()
  })

  it('says the file was matched by AI, and why, above the search', async () => {
    spies.search.mockImplementation(async () => [])
    renderWithProviders({
      ui: (
        <Harness
          media={unmatched}
          onMatched={() => undefined}
          aiMatch={{ reason: 'The title and year fit.' }}
        />
      ),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Matched by AI. The title and year fit.')
  })

  it('has the note describe the dialog, so a screen reader hears it on opening', async () => {
    spies.search.mockImplementation(async () => [])
    const first = renderWithProviders({
      ui: (
        <Harness
          media={unmatched}
          onMatched={() => undefined}
          aiMatch={{ reason: 'The title and year fit.' }}
        />
      ),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Matched by AI. The title and year fit.',
    )
    first.unmount()
    renderWithProviders({ ui: <Harness media={unmatched} onMatched={() => undefined} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby')
  })

  it('reads the movie behind a card for its AI note, and shows none for a file with no item', async () => {
    spies.search.mockImplementation(async () => [])
    spies.item.mockImplementation(async () =>
      itemDetails({ aiMatch: { reason: 'Only one result fits.' } }),
    )
    const first = renderWithProviders({
      ui: <Harness media={matchedMovie()} onMatched={() => undefined} />,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent('Matched by AI. Only one result fits.'),
    )
    first.unmount()
    renderWithProviders({ ui: <Harness media={unmatched} onMatched={() => undefined} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Matched by AI.')
  })

  it("reads no details for an episode's card, as an episode carries no AI note", async () => {
    spies.search.mockImplementation(async () => [])
    spies.item.mockImplementation(async () => itemDetails())
    const episode = mediaItem({
      match: 'matched',
      item: itemSummary({
        id: 41,
        type: 'episode',
        title: 'Good News About Hell',
        show: { id: 4, title: 'Severance' },
        season: 1,
        episode: 1,
      }),
    })
    renderWithProviders({
      ui: <Harness media={episode} matchType="show" onMatched={() => undefined} />,
    })
    await userEvent.click(screen.getByRole('button', { name: /^Options for/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(spies.item).not.toHaveBeenCalled()
  })
})

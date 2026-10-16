import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuggestedMovies, suggestedMoviesOf } from '@/components/SuggestedMovies/SuggestedMovies'
import { api } from '@/lib/api'
import { aiSuggestion, unmatchedFile } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const heat = (place: string) =>
  aiSuggestion({ tmdbId: '949', title: 'Heat', year: 1995, poster: null, place })

const FILES = [
  unmatchedFile({
    id: 1,
    folder: 'Movies A/Archie (2023)',
    fileName: 'Archie (2023) 1080p.mkv',
    title: 'Archie',
    year: 2023,
    aiSuggestion: aiSuggestion({ place: 'Movies A/Archie (2023)' }),
  }),
  unmatchedFile({
    id: 2,
    folder: 'Movies A/Archie (2023)',
    fileName: 'Archie (2023) 2160p.mkv',
    title: 'Archie',
    year: 2023,
    aiSuggestion: aiSuggestion({ place: 'Movies A/Archie (2023)' }),
  }),
  unmatchedFile({
    id: 3,
    folder: '',
    fileName: 'Heat.mkv',
    title: 'Heat',
    aiSuggestion: heat('Heat.mkv'),
  }),
  unmatchedFile({
    id: 4,
    folder: '',
    fileName: 'Thief.mkv',
    title: 'Thief',
    aiSuggestion: heat('Thief.mkv'),
  }),
  unmatchedFile({ id: 5, folder: 'Odds', fileName: 'Unknown.mkv', title: 'Unknown' }),
]

/** Two movies in one folder, which the lookup asked about each on its own. */
const ODDS = [
  unmatchedFile({
    id: 6,
    folder: 'Odds',
    fileName: 'Heat (1995).mkv',
    title: 'Heat',
    year: 1995,
    aiSuggestion: heat('Odds/Heat (1995).mkv'),
  }),
  unmatchedFile({
    id: 7,
    folder: 'Odds',
    fileName: 'Thief (1981).mkv',
    title: 'Thief',
    year: 1981,
    aiSuggestion: heat('Odds/Thief (1981).mkv'),
  }),
]

describe('suggestedMoviesOf', () => {
  it('gives a place one card, so two qualities of a movie in its folder are one, by its name', () => {
    expect(
      suggestedMoviesOf(FILES).map((entry) => [
        entry.file.id,
        entry.label,
        entry.suggestion.tmdbId,
      ]),
    ).toEqual([
      [1, 'Archie (2023)', '201000'],
      [3, 'Heat.mkv', '949'],
      [4, 'Thief.mkv', '949'],
    ])
  })

  it('keeps two movies of one folder apart, each by its file', () => {
    expect(suggestedMoviesOf(ODDS).map((entry) => [entry.file.id, entry.label])).toEqual([
      [6, 'Heat (1995).mkv'],
      [7, 'Thief (1981).mkv'],
    ])
  })
})

describe('SuggestedMovies', () => {
  const spies = { search: spyOn(api, 'searchMatches'), setMatch: spyOn(api, 'setMatch') }

  afterEach(() => {
    cleanup()
    spies.search.mockReset()
    spies.setMatch.mockReset()
  })

  it('shows nothing when the lookup suggested nothing', () => {
    const { container } = renderWithProviders(
      <SuggestedMovies files={FILES.slice(4)} libraryId={2} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("accepts a suggestion for the folder's first file, pointing it as Fix match would", async () => {
    spies.setMatch.mockImplementation(async () => unmatchedFile({ id: 1, match: 'manual' }))
    renderWithProviders(<SuggestedMovies files={FILES} libraryId={2} />)
    expect(screen.getByRole('region', { name: 'Suggested by AI' })).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Accept Archie: The Man Who Became Cary Grant (2023) for Archie (2023)',
      }),
    )
    expect(spies.setMatch).toHaveBeenCalledWith({ mediaId: 1, tmdbId: '201000' })
  })

  it('makes a card for each movie of a folder that holds two, labelled by its file', () => {
    renderWithProviders(<SuggestedMovies files={ODDS} libraryId={2} />)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText('Heat (1995).mkv')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Accept Heat (1995) for Thief (1981).mkv' }),
    ).toBeInTheDocument()
  })

  it("opens Fix match on the file's title, and hands focus back after", async () => {
    spies.search.mockImplementation(async () => [])
    renderWithProviders(<SuggestedMovies files={FILES.slice(2, 3)} libraryId={2} />)
    const fix = screen.getByRole('button', { name: 'Fix match for Heat.mkv' })
    await userEvent.click(fix)
    expect(screen.getByRole('searchbox', { name: 'Title' })).toHaveValue('Heat')
    await waitFor(() =>
      expect(spies.search.mock.calls[0]?.[0]).toMatchObject({
        subject: { kind: 'media', id: FILES[2]?.id },
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fix).toHaveFocus()
  })
})

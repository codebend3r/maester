import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuggestedMovies, suggestedMoviesOf } from '@/components/SuggestedMovies/SuggestedMovies'
import { api } from '@/lib/api'
import { aiSuggestion, unmatchedFile } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const HEAT = aiSuggestion({ tmdbId: '949', title: 'Heat', year: 1995, poster: null })

const FILES = [
  unmatchedFile({
    id: 1,
    folder: 'Archie (2023)',
    fileName: 'Archie (2023) 1080p.mkv',
    title: 'Archie',
    year: 2023,
    aiSuggestion: aiSuggestion(),
  }),
  unmatchedFile({
    id: 2,
    folder: 'Archie (2023)',
    fileName: 'Archie (2023) 2160p.mkv',
    title: 'Archie',
    year: 2023,
    aiSuggestion: aiSuggestion(),
  }),
  unmatchedFile({ id: 3, folder: '', fileName: 'Heat.mkv', title: 'Heat', aiSuggestion: HEAT }),
  unmatchedFile({ id: 4, folder: '', fileName: 'Thief.mkv', title: 'Thief', aiSuggestion: HEAT }),
  unmatchedFile({ id: 5, folder: 'Odds', fileName: 'Unknown.mkv', title: 'Unknown' }),
]

describe('suggestedMoviesOf', () => {
  it('gives a folder one card a suggestion, so two qualities are one, and each loose file its own', () => {
    expect(
      suggestedMoviesOf(FILES).map((entry) => [entry.file.id, entry.suggestion.tmdbId]),
    ).toEqual([
      [1, '201000'],
      [3, '949'],
      [4, '949'],
    ])
  })

  it('keeps two movies of one folder apart', () => {
    const odds = [
      unmatchedFile({ id: 6, folder: 'Odds', title: 'Heat', year: 1995, aiSuggestion: HEAT }),
      unmatchedFile({ id: 7, folder: 'Odds', title: 'Thief', year: 1981, aiSuggestion: HEAT }),
    ]
    expect(suggestedMoviesOf(odds).map((entry) => entry.file.id)).toEqual([6, 7])
  })
})

describe('SuggestedMovies', () => {
  const spies = { search: spyOn(api, 'searchMatches'), setMatch: spyOn(api, 'setMatch') }

  afterEach(() => {
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

  it("opens Fix match on the file's title, and hands focus back after", async () => {
    spies.search.mockImplementation(async () => [])
    renderWithProviders(<SuggestedMovies files={FILES.slice(2, 3)} libraryId={2} />)
    const fix = screen.getByRole('button', { name: 'Fix match for Heat.mkv' })
    await userEvent.click(fix)
    expect(screen.getByRole('searchbox', { name: 'Title' })).toHaveValue('Heat')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fix).toHaveFocus()
  })
})

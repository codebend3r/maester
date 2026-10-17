import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AiSuggestion } from '@raven/core'
import { AiSuggestionCard } from '@/components/AiSuggestionCard/AiSuggestionCard'
import { api } from '@/lib/api'
import { aiSuggestion } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const ACCEPT = 'Accept Archie: The Man Who Became Cary Grant (2023) for Archie'

const card = ({
  accept = async () => undefined,
  onFix = () => undefined,
  suggestion = aiSuggestion(),
}: {
  accept?: (tmdbId: string) => Promise<unknown>
  onFix?: () => void
  suggestion?: AiSuggestion
} = {}) =>
  renderWithProviders({
    ui: <AiSuggestionCard suggestion={suggestion} subject="Archie" accept={accept} onFix={onFix} />,
  })

describe('AiSuggestionCard', () => {
  it('shows the poster, what it suggests, and why', () => {
    const { container } = card()
    expect(
      screen.getByRole('article', {
        name: 'Suggested: Archie: The Man Who Became Cary Grant (2023)',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The only Archie series from 2023; its episode titles are generic.'),
    ).toBeInTheDocument()
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      api.candidatePosterUrl('/archie.jpg'),
    )
  })

  it('names a suggestion with no year by its title, and stands its first letter in for no poster', () => {
    const { container } = card({ suggestion: aiSuggestion({ year: null, poster: null }) })
    expect(
      screen.getByRole('article', { name: 'Suggested: Archie: The Man Who Became Cary Grant' }),
    ).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('accepts once with the id it suggests, holding Accept while that runs', async () => {
    const pending = held<undefined>()
    const accepted: string[] = []
    card({
      accept: (tmdbId) => {
        accepted.push(tmdbId)
        return pending.promise
      },
    })
    const accept = screen.getByRole('button', { name: ACCEPT })
    await userEvent.click(accept)
    expect(accept).toBeDisabled()
    await userEvent.click(accept)
    expect(accepted).toEqual(['201000'])
    pending.answer(undefined)
    // Not toBeEnabled: each miss prints the whole DOM (about 50 MB), and on CI a few
    // misses outlast waitFor's timeout before the mutation settles.
    await waitFor(() => expect(accept).not.toHaveAttribute('disabled'))
  })

  it('says why Accept failed, and stays', async () => {
    card({ accept: async () => Promise.reject(new Error('TMDB has no show with that id.')) })
    await userEvent.click(screen.getByRole('button', { name: ACCEPT }))
    expect(await screen.findByRole('alert')).toHaveTextContent('TMDB has no show with that id.')
    expect(screen.getByRole('button', { name: ACCEPT })).toBeEnabled()
  })

  it('opens Fix match', async () => {
    const opened: string[] = []
    card({ onFix: () => opened.push('fix') })
    await userEvent.click(screen.getByRole('button', { name: 'Fix match for Archie' }))
    expect(opened).toEqual(['fix'])
  })
})

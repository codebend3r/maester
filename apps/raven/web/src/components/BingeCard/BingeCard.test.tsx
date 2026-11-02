import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { api } from '@/lib/api'
import { BingeCard } from '@/components/BingeCard/BingeCard'
import { itemDetails, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { EPISODE_TWO, SEVERANCE } from '@/test/tv'

const CAST = [
  { personId: 1, name: 'Adam Scott', job: 'cast', role: 'Mark', photoVersion: null },
  { personId: 2, name: 'Britt Lower', job: 'cast', role: 'Helly', photoVersion: null },
  { personId: 3, name: 'Zach Cherry', job: 'cast', role: 'Dylan', photoVersion: null },
] as const

const SHOW = { ...SEVERANCE, credits: [...CAST], backdropVersion: 'b4' }

const spies = {
  next: spyOn(api, 'nextEpisode'),
  item: spyOn(api, 'getItem'),
}

describe('BingeCard', () => {
  afterEach(() => {
    cleanup()
    spies.next.mockReset()
    spies.item.mockReset()
  })

  it("writes a show's title, year, length, episode, two stars, the episode's synopsis and its progress", async () => {
    spies.next.mockResolvedValue(EPISODE_TWO)
    spies.item.mockResolvedValue(
      itemDetails({ id: 7, type: 'episode', summary: 'Mark is told to go on.' }),
    )
    renderWithProviders({
      ui: (
        <ul>
          <BingeCard details={SHOW} />
        </ul>
      ),
    })
    const card = screen.getByRole('listitem')
    expect(within(card).getByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/shows/4',
    )
    expect(await within(card).findByText('Mark is told to go on.')).toBeInTheDocument()
    expect(within(card).getByText('2022 · 55m')).toBeInTheDocument()
    expect(within(card).getByText('S01E02 · Half Loop')).toBeInTheDocument()
    expect(card.textContent).toContain('Starring Adam Scott, Britt Lower')
    expect(card.textContent).not.toContain('Zach Cherry')
    expect(within(card).getByText('45m left')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /^Play / })).toHaveAttribute('href', '/watch/13')
    expect(card.querySelector('img')?.getAttribute('src')).toContain(
      '/api/pictures/items/4/backdrop',
    )
  })

  it("keeps the show's synopsis and offers no Play while it has no episode to play", async () => {
    spies.next.mockResolvedValue(null)
    renderWithProviders({
      ui: (
        <ul>
          <BingeCard details={SHOW} />
        </ul>
      ),
    })
    const card = screen.getByRole('listitem')
    await waitFor(() => expect(spies.next).toHaveBeenCalled())
    expect(within(card).getByText(SEVERANCE.summary ?? '')).toBeInTheDocument()
    expect(within(card).queryByRole('link', { name: /^Play / })).toBeNull()
    expect(within(card).queryByText(/left$/)).toBeNull()
  })

  it("writes a movie's own synopsis, length and progress, and reads no episode", () => {
    const movie = itemDetails({
      id: 40,
      type: 'movie',
      title: 'Heat',
      year: 1995,
      summary: 'A crew and a cop.',
      credits: [...CAST],
      versions: [matchedMovie({ id: 20, duration: 6000, position: 1500 })],
    })
    renderWithProviders({
      ui: (
        <ul>
          <BingeCard details={movie} />
        </ul>
      ),
    })
    const card = screen.getByRole('listitem')
    expect(within(card).getByText('1995 · 1h 40m')).toBeInTheDocument()
    expect(within(card).getByText('A crew and a cop.')).toBeInTheDocument()
    expect(within(card).getByText('1h 15m left')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /^Play / })).toHaveAttribute('href', '/watch/20')
    expect(spies.next).not.toHaveBeenCalled()
  })
})

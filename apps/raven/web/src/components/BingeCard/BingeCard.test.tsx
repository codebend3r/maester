import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { api } from '@/lib/api'
import { BINGE_BACKDROP_SIZES, BingeCard } from '@/components/BingeCard/BingeCard'
import { itemDetails } from '@/test/fixtures'
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

  it("offers the image CDN's narrower backdrops, sized to the card", async () => {
    spies.next.mockResolvedValue(EPISODE_TWO)
    spies.item.mockResolvedValue(itemDetails({ id: 7, type: 'episode' }))
    const srcSet = '/.netlify/images?w=480 480w, /.netlify/images 1280w'
    const widths = spyOn(api, 'backdropSrcSet').mockReturnValue(srcSet)
    renderWithProviders({
      ui: (
        <ul>
          <BingeCard details={SHOW} />
        </ul>
      ),
    })
    const backdrop = screen.getByRole('listitem').querySelector('img[src*="/backdrop"]')
    expect(widths).toHaveBeenCalledWith({ id: 4, version: 'b4' })
    expect(backdrop).toHaveAttribute('srcset', srcSet)
    expect(backdrop).toHaveAttribute('sizes', BINGE_BACKDROP_SIZES)
    widths.mockRestore()
  })

  it('stands its logo in the corner for its name, and names the episode to start on before it is started', async () => {
    spies.next.mockResolvedValue({ ...EPISODE_TWO, position: 0 })
    spies.item.mockResolvedValue(itemDetails({ id: 7, type: 'episode' }))
    renderWithProviders({
      ui: (
        <ul>
          <BingeCard details={{ ...SHOW, logoVersion: 'l1' }} />
        </ul>
      ),
    })
    const card = screen.getByRole('listitem')
    const title = within(card).getByRole('link', { name: 'Severance' })
    expect(title).toHaveAttribute('href', '/shows/4')
    expect(title.querySelector('img')?.getAttribute('src')).toContain('/api/pictures/items/4/logo')
    expect(within(card).queryByText('Severance')).toBeNull()
    expect(await within(card).findByText('Start season 1 episode 2')).toBeInTheDocument()
    expect(within(card).queryByText(/left$/)).toBeNull()
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
})

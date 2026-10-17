import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { PersonPage, groupCredits, initialsOf } from '@/pages/PersonPage/PersonPage'
import { itemSummary } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const MATRIX = itemSummary({ id: 1, title: 'The Matrix', year: 1999 })
const SHOW = itemSummary({ id: 4, type: 'show', title: 'Severance', year: 2022 })

describe('groupCredits', () => {
  it('groups by job, keeping an item once per group', () => {
    const groups = groupCredits([
      { item: MATRIX, job: 'cast', role: 'Neo' },
      { item: MATRIX, job: 'producer', role: 'Producer' },
      { item: SHOW, job: 'guest', role: 'Himself' },
      { item: SHOW, job: 'cast', role: 'Himself' },
    ])
    expect(groups.map((group) => [group.title, group.credits.length])).toEqual([
      ['Acting', 2],
      ['Producing', 1],
    ])
  })
})

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Rebecca Ferguson')).toBe('RF')
    expect(initialsOf('guillermo  del Toro')).toBe('GD')
    expect(initialsOf('Zendaya')).toBe('Z')
  })
})

describe('PersonPage', () => {
  const spy = spyOn(api, 'getPerson')
  afterEach(() => {
    cleanup()
    spy.mockReset()
  })

  it("lists what raven holds of a person's, grouped by job, as poster cards", async () => {
    spy.mockImplementation(async () => ({
      id: 7,
      name: 'Keanu Reeves',
      photoVersion: 'k1',
      credits: [
        { item: MATRIX, job: 'cast', role: 'Neo' },
        { item: SHOW, job: 'director', role: 'Director' },
      ],
    }))
    renderWithProviders(
      <Routes>
        <Route path="people/:id" element={<PersonPage />} />
      </Routes>,
      { route: '/people/7' },
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Keanu Reeves' }),
    ).toBeInTheDocument()
    const acting = screen.getByRole('region', { name: 'Acting' })
    expect(within(acting).getByRole('link', { name: /The Matrix/ })).toHaveAttribute(
      'href',
      '/movies/1',
    )
    expect(within(acting).getByText('Neo')).toBeInTheDocument()
    const directing = screen.getByRole('region', { name: 'Directing' })
    expect(within(directing).getByRole('link', { name: /Severance/ })).toHaveAttribute(
      'href',
      '/shows/4',
    )
    const poster = acting.querySelector('img')
    expect(poster).toHaveAttribute('src', `/api/items/1/images/poster?v=${MATRIX.posterVersion}`)
    expect(poster?.getAttribute('srcset')?.split(', ')).toEqual([
      `/api/items/1/images/poster?v=${MATRIX.posterVersion}&w=185 185w`,
      `/api/items/1/images/poster?v=${MATRIX.posterVersion}&w=342 342w`,
      `/api/items/1/images/poster?v=${MATRIX.posterVersion} 500w`,
    ])
    expect(poster).toHaveAttribute('sizes', POSTER_SIZES.grid)
  })

  it("counts their credits over their name, and each group's titles by its heading", async () => {
    spy.mockImplementation(async () => ({
      id: 7,
      name: 'Keanu Reeves',
      photoVersion: 'k1',
      credits: [
        { item: MATRIX, job: 'cast', role: 'Neo' },
        { item: SHOW, job: 'guest', role: 'Himself' },
        { item: SHOW, job: 'director', role: 'Director' },
      ],
    }))
    renderWithProviders(
      <Routes>
        <Route path="people/:id" element={<PersonPage />} />
      </Routes>,
      { route: '/people/7' },
    )
    expect(await screen.findByText('In your libraries · 3 credits')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Acting' })).getByText('2 titles'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Directing' })).getByText('1 title'),
    ).toBeInTheDocument()
  })

  it('shows their initials where they have no photo, and says when nothing credits them', async () => {
    spy.mockImplementation(async () => ({
      id: 8,
      name: 'Bertha Navarro',
      photoVersion: null,
      credits: [],
    }))
    const { container } = renderWithProviders(
      <Routes>
        <Route path="people/:id" element={<PersonPage />} />
      </Routes>,
      { route: '/people/8' },
    )
    expect(
      await screen.findByText('Nothing in raven credits Bertha Navarro yet.'),
    ).toBeInTheDocument()
    expect(screen.getByText('BN')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('header img')).toBeNull()
    expect(screen.queryByText(/In your libraries/)).toBeNull()
  })
})

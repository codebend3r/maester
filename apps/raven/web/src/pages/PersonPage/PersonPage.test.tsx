import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { PersonPage, groupCredits } from '@/pages/PersonPage/PersonPage'
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

describe('PersonPage', () => {
  const spy = spyOn(api, 'getPerson')
  afterEach(() => spy.mockReset())

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
  })
})

import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import type { LibrarySettings, Saga } from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { SagaPage } from '@/pages/SagaPage/SagaPage'
import { itemSummary, library, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const movie = ({
  id,
  title,
  year,
  backdropVersion = null,
}: {
  id: number
  title: string
  year: number
  backdropVersion?: string | null
}) =>
  matchedMovie({
    id,
    title,
    duration: 2 * 3600 + 58 * 60,
    item: itemSummary({ id: id * 10, title, year, backdropVersion }),
  })

const RINGS: Saga = {
  tmdbId: '119',
  name: 'The Lord of the Rings Collection',
  media: [
    movie({ id: 7, title: 'The Fellowship of the Ring', year: 2001 }),
    movie({ id: 8, title: 'The Two Towers', year: 2002, backdropVersion: 'b1' }),
    movie({ id: 9, title: 'The Return of the King', year: 2003, backdropVersion: 'b2' }),
  ],
}

describe('SagaPage', () => {
  const spies = {
    get: spyOn(api, 'getLibrary'),
    sagas: spyOn(api, 'listSagas'),
    lock: spyOn(api, 'getLock'),
  }

  afterEach(() => Object.values(spies).forEach((spy) => spy.mockReset()))

  const open = ({
    route = '/libraries/2/sagas/119',
    settings = {},
  }: { route?: string; settings?: Partial<LibrarySettings> } = {}) => {
    spies.get.mockImplementation(async () =>
      library({
        id: 2,
        name: 'Films',
        settings: { ...library().settings, kind: 'movies', ...settings },
      }),
    )
    spies.sagas.mockImplementation(async () => [RINGS])
    renderWithProviders(
      <Routes>
        <Route path="libraries/:id/sagas/:sagaId" element={<SagaPage />} />
      </Routes>,
      { route },
    )
  }

  it('shows the saga under its backdrop, with each of its movies to play, oldest first', async () => {
    open()
    expect(
      await screen.findByRole('heading', { name: 'The Lord of the Rings Collection' }),
    ).toBeInTheDocument()
    expect(screen.getByText('3 movies')).toBeInTheDocument()
    expect(screen.getByText('2001 to 2003')).toBeInTheDocument()
    expect(screen.getByText('8h 54m in all')).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('link', { name: /^Play / })
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual([
      'Play The Fellowship of the Ring',
      'Play The Two Towers',
      'Play The Return of the King',
    ])
    expect(document.querySelector('img[src*="/api/items/80/images/backdrop?v=b1"]')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Sagas' })).toHaveAttribute(
      'href',
      '/libraries/2/sagas',
    )
  })

  it('finds nothing for a saga the library does not have', async () => {
    open({ route: '/libraries/2/sagas/999' })
    expect(await screen.findByText('Nothing lives at this address')).toBeInTheDocument()
  })

  it('waits for the PIN in a locked library, asking for no sagas', async () => {
    spies.lock.mockImplementation(async () => ({ available: true, unlocked: false }))
    open({ settings: { locked: true } })
    expect(await screen.findByRole('region', { name: 'Locked' })).toBeInTheDocument()
    expect(spies.sagas).not.toHaveBeenCalled()
  })
})

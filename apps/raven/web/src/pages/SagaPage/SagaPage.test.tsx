import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  type AdminLock,
  DEFAULT_SAGA_BACKDROP,
  type LibrarySettings,
  type Saga,
  type SagaBackdrop,
} from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { SagaPage } from '@/pages/SagaPage/SagaPage'
import { usePageBackdrop } from '@/stores/pageBackdrop'
import { itemSummary, library, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { WatchProbe } from '@/test/watchProbe'

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
  backdrop: DEFAULT_SAGA_BACKDROP,
  media: [
    movie({ id: 7, title: 'The Fellowship of the Ring', year: 2001 }),
    movie({ id: 8, title: 'The Two Towers', year: 2002, backdropVersion: 'b1' }),
    movie({ id: 9, title: 'The Return of the King', year: 2003, backdropVersion: 'b2' }),
  ],
}

const backdropOf = (id: number, version: string) =>
  document.querySelector(`img[src*="/api/items/${id}/images/backdrop?v=${version}"]`)

describe('SagaPage', () => {
  const spies = {
    get: spyOn(api, 'getLibrary'),
    sagas: spyOn(api, 'listSagas'),
    lock: spyOn(api, 'getLock'),
    pick: spyOn(api, 'setSagaBackdrop'),
  }

  afterEach(() => Object.values(spies).forEach((spy) => spy.mockReset()))

  const open = ({
    route = '/libraries/2/sagas/119',
    settings = {},
    backdrop = DEFAULT_SAGA_BACKDROP,
    adminLock,
  }: {
    route?: string
    settings?: Partial<LibrarySettings>
    backdrop?: SagaBackdrop
    adminLock?: AdminLock
  } = {}) => {
    spies.get.mockImplementation(async () =>
      library({
        id: 2,
        name: 'Films',
        settings: { ...library().settings, kind: 'movies', ...settings },
      }),
    )
    spies.sagas.mockImplementation(async () => [{ ...RINGS, backdrop }])
    renderWithProviders(
      <Routes>
        <Route path="libraries/:id/sagas/:sagaId" element={<SagaPage />} />
        <Route path="watch/:id" element={<WatchProbe />} />
      </Routes>,
      { route, adminLock },
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
        .getAllByRole('link', { name: /^Play The / })
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual([
      'Play The Fellowship of the Ring',
      'Play The Two Towers',
      'Play The Return of the King',
    ])
    expect(backdropOf(80, 'b1')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Sagas' })).toHaveAttribute(
      'href',
      '/libraries/2/sagas',
    )
  })

  it("fetches each movie's poster no wider than the saga's grid shows it", async () => {
    open()
    await screen.findByRole('heading', { name: 'The Lord of the Rings Collection' })
    const posters = [...document.querySelectorAll('img[src*="/images/poster"]')]
    expect(posters.map((poster) => poster.getAttribute('sizes'))).toEqual([
      POSTER_SIZES.grid,
      POSTER_SIZES.grid,
      POSTER_SIZES.grid,
    ])
  })

  it("lays out each movie's backdrop for the slideshow, from the first", async () => {
    open({ backdrop: { type: 'slideshow', motion: 'kenBurns' } })
    await screen.findByRole('heading', { name: 'The Lord of the Rings Collection' })
    expect(backdropOf(80, 'b1')).not.toBeNull()
    expect(backdropOf(90, 'b2')).not.toBeNull()
  })

  it('holds still the backdrop picked for it, and only that one', async () => {
    open({ backdrop: { type: 'still', itemId: 90 } })
    await screen.findByRole('heading', { name: 'The Lord of the Rings Collection' })
    expect(backdropOf(90, 'b2')).not.toBeNull()
    expect(backdropOf(80, 'b1')).toBeNull()
  })

  it('plays every movie one after another from Play all', async () => {
    open()
    await userEvent.click(await screen.findByRole('link', { name: 'Play all' }))
    expect(await screen.findByText('Playing 7, then 8, 9')).toBeInTheDocument()
  })

  it("leaves the saga's backdrop up when a movie is pointed at", async () => {
    open()
    const card = await screen.findByRole('link', { name: 'The Two Towers' })
    fireEvent.focusIn(card)
    expect(usePageBackdrop.getState().current).toBeNull()
  })

  it('saves the backdrop picked in Edit backdrop, held still on one movie', async () => {
    spies.pick.mockImplementation(async ({ backdrop }) => backdrop)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit backdrop' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit backdrop' })
    expect(within(dialog).getByRole('radio', { name: 'Crossfade' })).toBeChecked()
    expect(within(dialog).queryByRole('group', { name: 'Picture' })).toBeNull()

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Off' }))
    const pictures = within(dialog).getByRole('group', { name: 'Picture' })
    expect(within(pictures).getByRole('radio', { name: 'The Two Towers' })).toBeChecked()
    await userEvent.click(within(pictures).getByRole('radio', { name: 'The Return of the King' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(spies.pick).toHaveBeenCalledWith({
      libraryId: 2,
      sagaId: '119',
      backdrop: { type: 'still', itemId: 90 },
    })
    await waitFor(() => expect(spies.sagas).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('saves a slideshow by the motion picked', async () => {
    spies.pick.mockImplementation(async ({ backdrop }) => backdrop)
    open({ backdrop: { type: 'still', itemId: 90 } })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit backdrop' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit backdrop' })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Slide' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(spies.pick).toHaveBeenCalledWith({
      libraryId: 2,
      sagaId: '119',
      backdrop: { type: 'slideshow', motion: 'slide' },
    })
  })

  it('starts on the cover shown when the movie picked has left the saga, and saves that one', async () => {
    spies.pick.mockImplementation(async ({ backdrop }) => backdrop)
    open({ backdrop: { type: 'still', itemId: 990 } })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit backdrop' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit backdrop' })
    const pictures = within(dialog).getByRole('group', { name: 'Picture' })
    expect(within(pictures).getByRole('radio', { name: 'The Two Towers' })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(spies.pick).toHaveBeenCalledWith({
      libraryId: 2,
      sagaId: '119',
      backdrop: { type: 'still', itemId: 80 },
    })
  })

  it('keeps the picture picked while the motions are tried', async () => {
    open({ backdrop: { type: 'still', itemId: 90 } })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit backdrop' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit backdrop' })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Ken Burns' }))
    expect(within(dialog).queryByRole('group', { name: 'Picture' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Off' }))
    expect(within(dialog).getByRole('radio', { name: 'The Return of the King' })).toBeChecked()
  })

  it('offers Edit backdrop only with the admin lock off', async () => {
    open({ adminLock: { state: 'on', available: true } })
    expect(await screen.findByRole('link', { name: 'Play all' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit backdrop' })).toBeNull()
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

  it('marks every movie of the saga from its Watched toggle, by item in its library', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    open()
    const toggle = await screen.findByRole('button', { name: 'Watched' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    set.mockRestore()
    expect(calls).toEqual([
      {
        watched: true,
        targets: [70, 80, 90].map((id) => ({ kind: 'item', id, libraryId: 2 })),
      },
    ])
  })

  it('selects its movies from a Select button beside Play all, and marks them by file', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    open()
    const play = await screen.findByRole('link', { name: 'Play all' })
    const select = screen.getByRole('button', { name: 'Select' })
    expect(play.parentElement).toBe(select.parentElement)
    await userEvent.click(select)
    await userEvent.click(screen.getByRole('link', { name: 'The Two Towers' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select The Return of the King' }))
    expect(
      within(screen.getByRole('region', { name: 'Selection' })).getByRole('status'),
    ).toHaveTextContent('2 selected')
    expect(screen.queryByText('Watching 8')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    set.mockRestore()
    expect(calls).toEqual([
      {
        watched: true,
        targets: [
          { kind: 'media', id: 8 },
          { kind: 'media', id: 9 },
        ],
      },
    ])
  })
})

import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { SESSION_KINDS, readWatchState } from '@raven/core'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation, useParams } from 'react-router-dom'
import { ShuffleButton } from '@/components/ShuffleButton/ShuffleButton'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/render'
import { EPISODE_ONE, EPISODE_TWO } from '@/test/tv'

const Watching = () => {
  const id = Number(useParams().id)
  const handed = readWatchState({ state: useLocation().state, id })
  const after = (handed?.upNext ?? []).map((media) => media.fileName).join(', ')
  return (
    <p>
      Watching {handed ? handed.media.fileName : 'nothing handed over'}
      {handed?.session.kind === SESSION_KINDS.queue && `, shuffled, then ${after}`}
    </p>
  )
}

describe('ShuffleButton', () => {
  const random = spyOn(api, 'shuffleEpisodes')

  const open = () =>
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="shows/:id" element={<ShuffleButton itemId={4}>Shuffle</ShuffleButton>} />
          <Route path="watch/:id" element={<Watching />} />
        </Routes>
      ),
      route: '/shows/4',
    })

  afterEach(() => {
    random.mockReset()
    cleanup()
  })

  it('plays what the server deals first, handing the rest to the player to play after', async () => {
    random.mockImplementation(async () => [EPISODE_TWO, EPISODE_ONE])
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(
      await screen.findByText(
        `Watching ${EPISODE_TWO.fileName}, shuffled, then ${EPISODE_ONE.fileName}`,
      ),
    ).toBeInTheDocument()
    expect(random.mock.calls).toEqual([[4]])
  })

  it('says so when there is nothing to play', async () => {
    random.mockImplementation(async () => [])
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(await screen.findByRole('button', { name: 'Nothing to play' })).toBeDisabled()
  })

  it('offers itself again after a failed pick', async () => {
    random.mockImplementation(async () => {
      throw new Error('offline')
    })
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(await screen.findByRole('button', { name: 'Shuffle' })).toBeEnabled()
  })
})

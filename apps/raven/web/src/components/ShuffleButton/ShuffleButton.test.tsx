import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation, useParams } from 'react-router-dom'
import { ShuffleButton } from '@/components/ShuffleButton/ShuffleButton'
import { api } from '@/lib/api'
import { readWatchState } from '@/lib/itemLinks'
import { renderWithProviders } from '@/test/render'
import { EPISODE_ONE } from '@/test/tv'

const Watching = () => {
  const id = Number(useParams().id)
  const handed = readWatchState({ state: useLocation().state, id })
  return <p>Watching {handed ? handed.media.fileName : 'nothing handed over'}</p>
}

describe('ShuffleButton', () => {
  const random = spyOn(api, 'randomEpisode')

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

  it('plays what the server picks, handing the video to the player', async () => {
    random.mockImplementation(async () => EPISODE_ONE)
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(await screen.findByText(`Watching ${EPISODE_ONE.fileName}`)).toBeInTheDocument()
    expect(random.mock.calls).toEqual([[4]])
  })

  it('says so when there is nothing to play', async () => {
    random.mockImplementation(async () => null)
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

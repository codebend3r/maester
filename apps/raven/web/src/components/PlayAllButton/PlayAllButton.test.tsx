import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { SESSION_KINDS, readWatchState } from '@raven/core'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation, useParams } from 'react-router-dom'
import { PlayAllButton } from '@/components/PlayAllButton/PlayAllButton'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/render'
import { EPISODE_ONE, SEASON_ONE } from '@/test/tv'

const Watching = () => {
  const id = Number(useParams().id)
  const handed = readWatchState({ state: useLocation().state, id })
  return (
    <p>
      Watching {handed ? handed.media.fileName : 'nothing handed over'}
      {handed?.session.kind === SESSION_KINDS.show && ', through the show'}
    </p>
  )
}

describe('PlayAllButton', () => {
  const season = spyOn(api, 'getItem')

  const open = () =>
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="shows/:id" element={<PlayAllButton seasonId={5} />} />
          <Route path="watch/:id" element={<Watching />} />
        </Routes>
      ),
      route: '/shows/4',
    })

  afterEach(() => {
    season.mockReset()
    cleanup()
  })

  it("plays the season's first episode in the show's session, so it carries on past the season", async () => {
    season.mockImplementation(async () => SEASON_ONE)
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Play all' }))
    expect(
      await screen.findByText(`Watching ${EPISODE_ONE.fileName}, through the show`),
    ).toBeInTheDocument()
    expect(season.mock.calls).toEqual([[5]])
  })

  it('says so when the season has nothing to play', async () => {
    season.mockImplementation(async () => ({ ...SEASON_ONE, children: [] }))
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Play all' }))
    expect(await screen.findByRole('button', { name: 'Nothing to play' })).toBeDisabled()
  })
})

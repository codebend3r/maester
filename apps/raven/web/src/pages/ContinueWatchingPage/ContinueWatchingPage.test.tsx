import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import type { Home } from '@raven/core'
import { api } from '@/lib/api'
import { ContinueWatchingPage } from '@/pages/ContinueWatchingPage/ContinueWatchingPage'
import { mediaItem } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const getHome = spyOn(api, 'getHome')

const open = (home: Home) => {
  getHome.mockImplementation(async () => home)
  renderWithProviders({ ui: <ContinueWatchingPage /> })
}

describe('ContinueWatchingPage', () => {
  afterEach(() => {
    cleanup()
    getHome.mockReset()
  })

  it('lists every video in progress, past the few the home page shows', async () => {
    const watching = Array.from({ length: 10 }, (_, index) => ({
      media: mediaItem({ id: 100 + index, title: `Halfway ${index}`, position: 60 }),
      poster: null,
    }))
    open({ inProgress: watching, shelves: [] })
    expect(await screen.findByRole('heading', { name: 'Continue watching' })).toBeInTheDocument()
    const tiles = await screen.findAllByRole('listitem')
    expect(tiles).toHaveLength(10)
    expect(within(tiles[9]!).getByRole('link', { name: /^Play / })).toBeInTheDocument()
  })

  it('says so while it reads, and when nothing is in progress', async () => {
    getHome.mockImplementation(() => held<Home>().promise)
    renderWithProviders({ ui: <ContinueWatchingPage /> })
    expect(await screen.findByText('Gathering what you were watching')).toBeInTheDocument()
    cleanup()
    open({ inProgress: [], shelves: [] })
    expect(await screen.findByText(/Nothing in progress/)).toBeInTheDocument()
  })
})

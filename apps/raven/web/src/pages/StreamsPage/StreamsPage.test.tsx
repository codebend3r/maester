import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { ApiError, PLAYBACK_MODES } from '@raven/core'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { StreamsPage } from '@/pages/StreamsPage/StreamsPage'
import { fakeAccount } from '@/test/authClient'
import { itemSummary, liveStream, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('StreamsPage', () => {
  const spies = { list: spyOn(api, 'listLiveStreams'), stop: spyOn(api, 'stopStream') }

  afterEach(() => {
    cleanup()
    spies.list.mockReset()
    spies.stop.mockReset()
  })

  it('shows what is streaming, to which device and browser, and how far along', async () => {
    spies.list.mockImplementation(async () => [
      liveStream({
        media: mediaItem({
          title: 'Busboys',
          duration: 3600,
          item: itemSummary({ type: 'movie', title: 'Busboys', year: 2026 }),
        }),
        libraryName: 'Films',
        browser: 'Safari 18',
        device: 'iPhone',
        address: '203.0.113.9',
        mode: PLAYBACK_MODES.transcode,
        position: 754,
      }),
    ])
    renderWithProviders({ ui: <StreamsPage /> })

    expect(await screen.findByRole('heading', { name: 'Busboys (2026)' })).toBeInTheDocument()
    expect(screen.getByText('1 stream')).toBeInTheDocument()
    expect(screen.getByText('Films')).toBeInTheDocument()
    const facts = screen.getByRole('listitem')
    expect(within(facts).getByText('iPhone')).toBeInTheDocument()
    expect(within(facts).getByText('Safari 18')).toBeInTheDocument()
    expect(within(facts).getByText('203.0.113.9')).toBeInTheDocument()
    expect(within(facts).getByText('Transcoding')).toBeInTheDocument()
    expect(within(facts).getByText('12:34 of 1:00:00')).toBeInTheDocument()
  })

  it('says Starting until the player has reported a spot', async () => {
    spies.list.mockImplementation(async () => [liveStream({ position: null })])
    renderWithProviders({ ui: <StreamsPage /> })
    expect(await screen.findByText('Starting')).toBeInTheDocument()
  })

  it('says so when nobody is streaming', async () => {
    spies.list.mockImplementation(async () => [])
    renderWithProviders({ ui: <StreamsPage /> })
    expect(await screen.findByText('Nobody is streaming right now')).toBeInTheDocument()
  })

  it('stops a stream by its id and reads the list again', async () => {
    spies.list.mockImplementation(async () => [liveStream({ id: 'abc', device: 'Mac' })])
    spies.stop.mockImplementation(async () => undefined)
    renderWithProviders({ ui: <StreamsPage /> })
    const stop = await screen.findByRole('button', { name: /^Stop .* on Mac, Chrome 141$/ })

    spies.list.mockImplementation(async () => [])
    await userEvent.click(stop)

    expect(spies.stop).toHaveBeenCalledWith('abc')
    expect(await screen.findByText('Nobody is streaming right now')).toBeInTheDocument()
  })

  it('says why a stream could not be stopped, and keeps it listed', async () => {
    spies.list.mockImplementation(async () => [liveStream()])
    spies.stop.mockImplementation(async () => {
      throw new ApiError({ status: 404, message: 'That stream is not live any more' })
    })
    renderWithProviders({ ui: <StreamsPage /> })
    await userEvent.click(await screen.findByRole('button', { name: /^Stop / }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not stop it: That stream is not live any more',
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /^Stop / })).toBeEnabled())
  })

  it('asks for nothing and points to Settings while the admin lock is on', () => {
    renderWithProviders({ ui: <StreamsPage />, adminLock: { state: 'on', available: true } })
    expect(screen.getByRole('heading', { name: 'Streams are for the admin' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('lists the streams for the owner of a server with accounts', async () => {
    spies.list.mockImplementation(async () => [liveStream({ device: 'Mac' })])
    renderWithProviders({
      ui: <StreamsPage />,
      account: fakeAccount({ isOwner: true }),
      adminLock: null,
    })
    expect(await screen.findByText('Mac')).toBeInTheDocument()
  })

  it('says streams are for the owner to a member, and asks for nothing', () => {
    renderWithProviders({ ui: <StreamsPage />, account: fakeAccount(), adminLock: null })
    expect(screen.getByRole('heading', { name: 'Streams are for the owner' })).toBeInTheDocument()
    expect(screen.queryByText(/admin lock/i)).toBeNull()
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('says when the server did not answer', async () => {
    spies.list.mockImplementation(async () => {
      throw new ApiError({ status: 500, message: 'Boom' })
    })
    renderWithProviders({ ui: <StreamsPage /> })
    expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer: Boom')
  })
})

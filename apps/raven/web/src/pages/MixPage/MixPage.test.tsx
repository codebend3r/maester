import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { MIX_KINDS } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { MixPage } from '@/pages/MixPage/MixPage'
import { mixDetails, mixSummary, track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const renderPage = (route = '/music/mixes/rediscover') =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path="/music/mixes/:id" element={<MixPage />} />
      </Routes>
    ),
    route,
  })

describe('MixPage', () => {
  beforeEach(() => useAudioQueue.getState().clear())

  afterEach(() => {
    cleanup()
    mock.restore()
    useAudioQueue.getState().clear()
  })

  it('plays the mix as a queue whose source is the mix', async () => {
    const getMix = spyOn(api, 'getMix').mockResolvedValue(
      mixDetails({ mix: mixSummary({ id: MIX_KINDS.rediscover, trackCount: 2, duration: 400 }) }),
    )
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Rediscover' })).toBeInTheDocument()
    expect(getMix).toHaveBeenCalledWith({ id: MIX_KINDS.rediscover })
    expect(screen.getByText('2 tracks · 7 min')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/music')
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(useAudioQueue.getState().queue.items).toEqual([101, 102])
    expect(useAudioQueue.getState().queue.source).toEqual({ kind: 'mix', id: 'rediscover' })
    fireEvent.click(screen.getByRole('button', { name: 'Play Paranoid Android' }))
    expect(useAudioQueue.getState().queue.at).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(useAudioQueue.getState().queue.isShuffled).toBe(true)
  })

  it('starts a radio from one of its tracks', async () => {
    spyOn(api, 'getMix').mockResolvedValue(mixDetails())
    const getRadio = spyOn(api, 'getRadio').mockResolvedValue([track({ id: 301 })])
    renderPage('/music/mixes/heavyRotation')
    fireEvent.click(await screen.findByRole('button', { name: 'Start radio from Airbag' }))
    await waitFor(() =>
      expect(useAudioQueue.getState().queue.source).toEqual({
        kind: 'radio',
        id: 101,
        seed: 'track',
      }),
    )
    expect(getRadio).toHaveBeenCalledWith({ seed: { kind: 'track', id: 101 } })
  })

  it('finds nothing at an address that names no mix, asks for none, and goes home to the music', () => {
    const getMix = spyOn(api, 'getMix')
    renderPage('/music/mixes/everything')
    expect(
      screen.getByRole('heading', { name: 'Nothing lives at this address' }),
    ).toBeInTheDocument()
    expect(getMix).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/music')
  })
})

import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import type { MediaStreams } from '@raven/core'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DolbyVisionNotice } from '@/components/Player/DolbyVisionNotice'
import { api } from '@/test/api'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const HEADING = 'Why the colours look off'

const streamsOf = (isDolbyVisionOnly: boolean): MediaStreams => ({
  video: {
    codec: 'hevc',
    profile: 'Main 10',
    bitrate: null,
    range: isDolbyVisionOnly ? 'dolbyVision' : 'hdr10',
    isDolbyVisionOnly,
    dolbyVision: null,
  },
  audio: [],
})

const spies: Array<{ mockRestore: () => void }> = []

const stubStreams = (streams: MediaStreams) => {
  const spy = spyOn(api, 'getStreams').mockImplementation(async () => streams)
  spies.push(spy)
  return spy
}

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

describe('DolbyVisionNotice', () => {
  it('says why the colours are off and where they play true, until dismissed', async () => {
    stubStreams(streamsOf(true))
    renderWithProviders({ ui: <DolbyVisionNotice api={api} media={mediaItem({ hdr: true })} /> })
    const notice = await screen.findByRole('complementary', { name: HEADING })
    expect(notice).toHaveTextContent(/Dolby Vision profile 5/)
    expect(notice).toHaveTextContent(/Apple TV 4K/)
    expect(notice).not.toHaveTextContent(/another version/)
    await userEvent.click(screen.getByRole('button', { name: 'Keep watching' }))
    expect(screen.queryByRole('complementary', { name: HEADING })).toBeNull()
  })

  it('points to the other versions when there are some', async () => {
    stubStreams(streamsOf(true))
    renderWithProviders({
      ui: <DolbyVisionNotice api={api} media={mediaItem({ hdr: true, versions: 2 })} />,
    })
    expect(await screen.findByRole('complementary', { name: HEADING })).toHaveTextContent(
      'Or go back and pick another version of it.',
    )
  })

  it('says nothing of an HDR10 picture', async () => {
    const getStreams = stubStreams(streamsOf(false))
    renderWithProviders({ ui: <DolbyVisionNotice api={api} media={mediaItem({ hdr: true })} /> })
    await waitFor(() => expect(getStreams).toHaveBeenCalledWith(7))
    expect(screen.queryByRole('complementary', { name: HEADING })).toBeNull()
  })

  it('never probes an SDR file', () => {
    const getStreams = stubStreams(streamsOf(true))
    renderWithProviders({ ui: <DolbyVisionNotice api={api} media={mediaItem()} /> })
    expect(getStreams).not.toHaveBeenCalled()
    expect(screen.queryByRole('complementary', { name: HEADING })).toBeNull()
  })
})

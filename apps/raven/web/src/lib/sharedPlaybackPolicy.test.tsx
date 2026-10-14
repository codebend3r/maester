import { describe, expect, it, spyOn } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import { SharedPlaybackPolicy } from '@/lib/sharedPlaybackPolicy'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('SharedPlaybackPolicy', () => {
  it('asks for the playback settings as it mounts, before any card needs them', () => {
    const settings = spyOn(api, 'getPlaybackSettings').mockImplementation(
      () => new Promise(() => {}),
    )
    renderWithProviders(
      <SharedPlaybackPolicy>
        <p>Nothing listed yet</p>
      </SharedPlaybackPolicy>,
      { playback: null },
    )
    expect(settings).toHaveBeenCalledTimes(1)
    settings.mockRestore()
  })

  it('reads the playback settings once for a whole grid of cards', () => {
    const items = [1, 2, 3].map((id) => mediaItem({ id }))
    const { client } = renderWithProviders(<MediaGrid items={items} posters />)
    const settings = client.getQueryCache().find({ queryKey: queryKeys.playbackSettings })
    expect(settings?.getObserversCount()).toBe(1)
  })

  it('fails loudly for a playback note with nothing to read the settings from', () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <PlaybackNote media={mediaItem()} />
        </QueryClientProvider>,
      ),
    ).toThrow('SharedPlaybackPolicy')
    quiet.mockRestore()
  })
})

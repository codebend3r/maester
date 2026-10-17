import { describe, expect, it, spyOn } from 'bun:test'
import { api } from '@/lib/api'
import { PrefetchPlaybackSettings } from '@/lib/prefetchPlaybackSettings'
import { renderWithProviders } from '@/test/render'

describe('PrefetchPlaybackSettings', () => {
  it('asks for the playback settings as it mounts, before any card needs them', () => {
    const settings = spyOn(api, 'getPlaybackSettings').mockImplementation(
      () => new Promise(() => {}),
    )
    renderWithProviders({
      ui: (
        <PrefetchPlaybackSettings>
          <p>Nothing listed yet</p>
        </PrefetchPlaybackSettings>
      ),
      playback: null,
    })
    expect(settings).toHaveBeenCalledTimes(1)
    settings.mockRestore()
  })
})

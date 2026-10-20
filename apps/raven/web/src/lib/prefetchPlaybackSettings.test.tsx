import { describe, expect, it, spyOn } from 'bun:test'
import { AUTH_CONFIG_STATES } from '@raven/core'
import { api } from '@/lib/api'
import { PrefetchPlaybackSettings } from '@/lib/prefetchPlaybackSettings'
import { fakeAccount, readyConfig } from '@/test/authClient'
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

  const render = (options: Partial<Parameters<typeof renderWithProviders>[0]>) =>
    renderWithProviders({
      ui: (
        <PrefetchPlaybackSettings>
          <p>Nothing listed yet</p>
        </PrefetchPlaybackSettings>
      ),
      playback: null,
      ...options,
    })

  it('waits while nobody is signed in, and draws what is beneath it', () => {
    const settings = spyOn(api, 'getPlaybackSettings').mockImplementation(
      () => new Promise(() => {}),
    )
    const { getByText } = render({ authConfig: readyConfig })
    expect(getByText('Nothing listed yet')).toBeInTheDocument()
    expect(settings).not.toHaveBeenCalled()
    settings.mockRestore()
  })

  it('waits while accounts cannot be reached', () => {
    const settings = spyOn(api, 'getPlaybackSettings').mockImplementation(
      () => new Promise(() => {}),
    )
    render({ authConfig: { state: AUTH_CONFIG_STATES.unavailable } })
    expect(settings).not.toHaveBeenCalled()
    settings.mockRestore()
  })

  it('asks once an account is approved', () => {
    const settings = spyOn(api, 'getPlaybackSettings').mockImplementation(
      () => new Promise(() => {}),
    )
    render({ account: fakeAccount() })
    expect(settings).toHaveBeenCalledTimes(1)
    settings.mockRestore()
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import { STATUS_COPY } from '@raven/wren'
import { cleanup, screen } from '@testing-library/react'
import { mockMusicApi } from '@/test/music'
import { renderKitWithRoutes } from '@/test/render'
import { ServerStatusChip } from '@/ui/ServerStatusChip/ServerStatusChip'

describe('ServerStatusChip', () => {
  const state: { music: ReturnType<typeof mockMusicApi> | null } = { music: null }

  afterEach(() => {
    cleanup()
    state.music?.restore()
    state.music = null
  })

  it('says raven answers once its libraries are read, and that it does not when they cannot be', async () => {
    state.music = mockMusicApi()
    const { unmount } = renderKitWithRoutes(<ServerStatusChip />)
    expect(await screen.findByText(STATUS_COPY.connected(STATUS_COPY.raven))).toBeInTheDocument()
    unmount()

    state.music.listLibraries.mockRejectedValue(new TypeError('Failed to fetch'))
    renderKitWithRoutes(<ServerStatusChip />)

    expect(await screen.findByText(STATUS_COPY.unreachable(STATUS_COPY.raven))).toBeInTheDocument()
  })
})

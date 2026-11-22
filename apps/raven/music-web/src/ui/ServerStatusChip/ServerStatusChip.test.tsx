import { describe, expect, it } from 'bun:test'
import { STATUS_COPY } from '@raven/wren'
import { screen } from '@testing-library/react'
import { mockMusicApiEach } from '@/test/music'
import { renderKitWithRoutes } from '@/test/render'
import { ServerStatusChip } from '@/ui/ServerStatusChip/ServerStatusChip'

describe('ServerStatusChip', () => {
  const music = mockMusicApiEach()

  it('says raven answers once its libraries are read, and that it does not when they cannot be', async () => {
    const { unmount } = renderKitWithRoutes(<ServerStatusChip />)
    expect(await screen.findByText(STATUS_COPY.connected(STATUS_COPY.raven))).toBeInTheDocument()
    unmount()

    music().listLibraries.mockRejectedValue(new TypeError('Failed to fetch'))
    renderKitWithRoutes(<ServerStatusChip />)

    expect(await screen.findByText(STATUS_COPY.unreachable(STATUS_COPY.raven))).toBeInTheDocument()
  })
})

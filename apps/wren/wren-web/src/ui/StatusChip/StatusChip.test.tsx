import { describe, expect, it } from 'bun:test'
import { STATUS_COPY } from '@raven/wren'
import { screen } from '@testing-library/react'
import { renderKitWithRoutes } from '@/test/render'
import { StatusChip } from '@/ui/StatusChip/StatusChip'

describe('StatusChip', () => {
  it("says a server's state in words as well as its dot", () => {
    renderKitWithRoutes(
      <>
        <StatusChip isConnected name="raven" />
        <StatusChip isConnected={false} name="attic" />
      </>,
    )

    expect(screen.getByText(STATUS_COPY.connected('raven'))).toBeInTheDocument()
    expect(screen.getByText(STATUS_COPY.unreachable('attic'))).toBeInTheDocument()
  })
})

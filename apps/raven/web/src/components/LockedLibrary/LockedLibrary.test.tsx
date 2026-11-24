import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { useActiveServer } from '@raven/ui/headless'
import { LockedLibrary } from '@/components/LockedLibrary/LockedLibrary'
import { renderWithProviders } from '@/test/render'
import { MELEYS_ID, MELEYS_ORIGIN } from '@/test/servers'

describe('LockedLibrary', () => {
  it('gives the owner Unlock on the home server', () => {
    renderWithProviders({ ui: <LockedLibrary name="Tutorials" available /> })
    expect(screen.getByText('Tutorials is locked.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument()
  })

  it("points the owner to the server's own page on another server, where a PIN cannot hold", () => {
    useActiveServer.getState().choose({ serverId: MELEYS_ID, origin: MELEYS_ORIGIN })
    renderWithProviders({ ui: <LockedLibrary name="Tutorials" available /> })
    expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull()
    expect(screen.getByText(/holds only on a server's own page/)).toBeInTheDocument()
  })

  it('only says it is locked to anyone else', () => {
    renderWithProviders({ ui: <LockedLibrary name="Tutorials" available={false} /> })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

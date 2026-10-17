import { describe, expect, it, spyOn } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import type { PlayerServices } from '@/components/Player/PlayerServices'
import { useHostPlayer, useHostServices, usePlayerServices } from '@/stores/playerServices'

const servicesFor = (label: string): PlayerServices => ({
  title: { label, duration: null, resumeAt: 0, backTo: '/', next: null },
  progress: { started: () => {}, save: () => {}, left: () => {} },
  posterUrl: null,
  escape: null,
})

/** Stands in for the player: notes the title its first render read. */
const Probe = ({ firsts }: { firsts: string[] }) => {
  const { title } = useHostServices()
  const [first] = useState(title.label)
  useEffect(() => {
    firsts.push(first)
  }, [firsts, first])
  return <p>{title.label}</p>
}

const Host = ({ services, firsts = [] }: { services: PlayerServices; firsts?: string[] }) => {
  const isHosting = useHostPlayer(services)
  return isHosting && <Probe firsts={firsts} />
}

describe('useHostPlayer', () => {
  it("renders the player on this host's services, never the last host's", () => {
    const firsts: string[] = []
    const { rerender } = render(<Host key="a" services={servicesFor('First')} firsts={firsts} />)
    expect(screen.getByText('First')).toBeInTheDocument()
    rerender(<Host key="b" services={servicesFor('Second')} firsts={firsts} />)
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(firsts).toEqual(['First', 'Second'])
  })

  it('hands the player new services as the host renders them', () => {
    const firsts: string[] = []
    const { rerender } = render(<Host services={servicesFor('First')} firsts={firsts} />)
    rerender(<Host services={servicesFor('Renamed')} firsts={firsts} />)
    expect(screen.getByText('Renamed')).toBeInTheDocument()
    expect(firsts).toEqual(['First'])
  })

  it('takes its services away when it goes, and leaves a later host its own', () => {
    const { unmount } = render(<Host services={servicesFor('Leaving')} />)
    unmount()
    expect(usePlayerServices.getState()).toEqual({ host: null, services: null })

    const earlier = servicesFor('Earlier')
    const later = servicesFor('Later')
    // Both mounted at once, the later one set its services last.
    const Pair = ({ hasEarlier }: { hasEarlier: boolean }) => (
      <>
        {hasEarlier && <Host services={earlier} />}
        <Host services={later} />
      </>
    )
    const { rerender } = render(<Pair hasEarlier />)
    expect(usePlayerServices.getState().services).toBe(later)
    rerender(<Pair hasEarlier={false} />)
    expect(usePlayerServices.getState().services).toBe(later)
  })
})

describe('useHostServices', () => {
  it('fails loudly when the player renders before its host set the services', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<Probe firsts={[]} />)).toThrow(
        'The host sets the player services before the player',
      )
    } finally {
      error.mockRestore()
    }
  })
})

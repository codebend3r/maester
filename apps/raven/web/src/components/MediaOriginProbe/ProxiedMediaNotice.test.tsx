import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ADMIN_LOCK_STATES, AUTH_CONFIG_STATES } from '@raven/core'
import { useMediaOrigin, useToasts } from '@raven/ui'
import { queryKeys } from '@raven/ui/headless'
import { act, cleanup, render } from '@testing-library/react'
import { PROXIED_MEDIA_COPY, PROXIED_MEDIA_WARNING } from '@/components/MediaOriginProbe/copy'
import { ProxiedMediaNotice } from '@/components/MediaOriginProbe/ProxiedMediaNotice'

let warn: Mock<typeof console.warn>

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})

// Unmounted first: the notice reads the store, and a reset it sees is an update outside act.
afterEach(() => {
  cleanup()
  warn.mockRestore()
  useMediaOrigin.setState({ pick: null, remote: null, isProbing: false, hasProbed: false })
  useToasts.setState({ toasts: [] })
})

type ManagedByProps = { isLocked: boolean }

/** Accounts off, with the admin lock on or off: off is what lets this browser manage. */
const managedBy = ({ isLocked }: ManagedByProps) => {
  const client = new QueryClient()
  client.setQueryData(queryKeys.authConfig, { state: AUTH_CONFIG_STATES.off })
  client.setQueryData(queryKeys.adminLock, {
    state: isLocked ? ADMIN_LOCK_STATES.on : ADMIN_LOCK_STATES.off,
  })
  return client
}

type RenderNoticeProps = { isProxiedHost?: boolean; isLocked?: boolean }

const renderNotice = ({ isProxiedHost = true, isLocked = false }: RenderNoticeProps = {}) =>
  render(
    <QueryClientProvider client={managedBy({ isLocked })}>
      <ProxiedMediaNotice isProxiedHost={isProxiedHost} />
    </QueryClientProvider>,
  )

const probeEndsWith = (pick: { kind: 'lan'; url: string } | null) => {
  act(() => useMediaOrigin.getState().setProbing(true))
  act(() => {
    useMediaOrigin.getState().setPick(pick ? { origin: pick, at: Date.now() } : null)
    useMediaOrigin.getState().setProbing(false)
  })
}

const messages = () => useToasts.getState().toasts.map(({ message }) => message)

describe('ProxiedMediaNotice', () => {
  it('warns once, and toasts the manager once, when a probe ends with no origin', () => {
    renderNotice()
    expect(warn).not.toHaveBeenCalled()
    probeEndsWith(null)
    probeEndsWith(null)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(PROXIED_MEDIA_WARNING)
    expect(messages()).toEqual([PROXIED_MEDIA_COPY.toast])
  })

  it('says nothing before the first probe ends, or when the probe picks an origin', () => {
    renderNotice()
    probeEndsWith({ kind: 'lan', url: 'https://raven.home.example' })
    expect(warn).not.toHaveBeenCalled()
    expect(messages()).toEqual([])
  })

  it('warns in the console but shows no toast to a viewer who cannot manage raven', () => {
    renderNotice({ isLocked: true })
    probeEndsWith(null)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(messages()).toEqual([])
  })

  it('says nothing on a host that is raven itself', () => {
    renderNotice({ isProxiedHost: false })
    probeEndsWith(null)
    expect(warn).not.toHaveBeenCalled()
    expect(messages()).toEqual([])
  })
})

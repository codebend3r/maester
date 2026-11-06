import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, waitFor } from '@testing-library/react'
import {
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  REMOTE_ACCESS_STATES,
  type RemoteAccessState,
} from '@raven/core'
import { useServerRemoteAccess } from '@/query/useServerRemoteAccess'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const { api } = recordingApi({ body: null })

const spies = {
  read: spyOn(api, 'getRemoteAccess'),
  save: spyOn(api, 'setRemoteAccess'),
}

const OFF: RemoteAccessState = {
  settings: DEFAULT_REMOTE_ACCESS_SETTINGS,
  privateAddress: 'raven.home.example',
  publicOrigin: null,
  status: { state: REMOTE_ACCESS_STATES.disabled },
}

const ON: RemoteAccessState = {
  ...OFF,
  settings: { ...DEFAULT_REMOTE_ACCESS_SETTINGS, isEnabled: true },
}

const setUp = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderQueryHook({ client, hook: () => useServerRemoteAccess({ api }) })
}

describe('useServerRemoteAccess', () => {
  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  it('reads Remote Access, saves a change and shows the answer without reading again', async () => {
    spies.read.mockResolvedValue(OFF)
    spies.save.mockResolvedValue(ON)
    const { result } = setUp()
    await waitFor(() => expect(result.current.state.data).toEqual(OFF))
    act(() => result.current.save.mutate({ isEnabled: true }))
    await waitFor(() => expect(result.current.state.data).toEqual(ON))
    expect(spies.save).toHaveBeenCalledWith({ isEnabled: true })
    expect(spies.read).toHaveBeenCalledTimes(1)
  })

  it('says why a save was refused', async () => {
    spies.read.mockResolvedValue(OFF)
    spies.save.mockRejectedValue(new Error('refused'))
    const { result } = setUp()
    await waitFor(() => expect(result.current.state.data).toEqual(OFF))
    act(() => result.current.save.mutate({ isEnabled: true }))
    await waitFor(() => expect(result.current.save.error?.message).toBe('refused'))
  })
})

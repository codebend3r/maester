import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { NOTIFICATION_TONES } from '@raven/core'
import { useToasts } from '@raven/ui'
import { act, cleanup, waitFor } from '@testing-library/react'
import { api } from '@/lib/api'
import { unloggedToasts, useLogToasts } from '@/lib/useLogToasts'
import { renderWithProviders } from '@/test/render'

const LogToasts = () => {
  useLogToasts()
  return null
}

const AT = '2026-11-08T12:00:00.000Z'

describe('useLogToasts', () => {
  const log = spyOn(api, 'logNotification')

  afterEach(() => {
    cleanup()
    log.mockReset()
  })

  it('logs each toast this screen raises as it appears, and none the server sent', async () => {
    log.mockImplementation(async ({ message, tone }) => ({ id: 1, message, tone, at: AT }))
    renderWithProviders({ ui: <LogToasts /> })
    act(() => useToasts.getState().show('Added to Road trip.'))
    act(() =>
      useToasts.getState().showNotification({
        id: 2,
        message: 'Smart match is done.',
        tone: NOTIFICATION_TONES.info,
        at: AT,
      }),
    )
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    expect(log).toHaveBeenCalledWith({
      message: 'Added to Road trip.',
      tone: NOTIFICATION_TONES.success,
    })
  })

  it('still shows a toast the server would not log', async () => {
    log.mockImplementation(async () => {
      throw new Error('Signed out')
    })
    renderWithProviders({ ui: <LogToasts /> })
    act(() => useToasts.getState().show('Saved.'))
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    expect(useToasts.getState().toasts.map(({ message }) => message)).toEqual(['Saved.'])
  })
})

describe('unloggedToasts', () => {
  it('picks the new toasts the server has not logged', () => {
    const shown = { id: 1, message: 'Saved.', tone: NOTIFICATION_TONES.success, isLogged: false }
    const sent = { id: 2, message: 'Done.', tone: NOTIFICATION_TONES.info, isLogged: true }
    const fresh = { id: 3, message: 'Deleted.', tone: NOTIFICATION_TONES.success, isLogged: false }
    expect(unloggedToasts({ toasts: [shown, sent, fresh], before: [shown] })).toEqual([fresh])
  })
})

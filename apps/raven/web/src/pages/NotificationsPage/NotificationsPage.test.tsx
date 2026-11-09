import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { NOTIFICATION_TONES } from '@raven/core'
import { cleanup, screen, within } from '@testing-library/react'
import { api } from '@/lib/api'
import { NotificationsPage } from '@/pages/NotificationsPage/NotificationsPage'
import { renderWithProviders } from '@/test/render'

describe('NotificationsPage', () => {
  const list = spyOn(api, 'listNotifications')

  afterEach(() => {
    cleanup()
    list.mockReset()
  })

  it("lists the account's notifications newest first, each with its tone and time", async () => {
    list.mockImplementation(async () => [
      {
        id: 2,
        message: 'Smart match stopped: MusicBrainz is down',
        tone: NOTIFICATION_TONES.failure,
        at: '2026-11-08T12:05:00.000Z',
      },
      {
        id: 1,
        message: 'Added to Road trip.',
        tone: NOTIFICATION_TONES.success,
        at: '2026-11-08T12:00:00.000Z',
      },
    ])
    renderWithProviders({ ui: <NotificationsPage /> })
    expect(await screen.findByText('Smart match stopped: MusicBrainz is down')).toBeInTheDocument()
    expect(
      screen.getByText("2 notifications, newest first. Only your account's show here."),
    ).toBeInTheDocument()
    const [failed, added] = screen.getAllByRole('listitem')
    if (!failed || !added) throw new Error('two notifications should be listed')
    expect(within(failed).getByText('Failed')).toBeInTheDocument()
    expect(within(added).getByText('Done')).toBeInTheDocument()
    expect(within(added).getByText('Added to Road trip.')).toBeInTheDocument()
    expect(failed.querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-08T12:05:00.000Z')
  })

  it('says so when there are none yet, and when the server does not answer', async () => {
    list.mockImplementation(async () => [])
    renderWithProviders({ ui: <NotificationsPage /> })
    expect(
      await screen.findByText('No notifications yet. Every toast that appears is kept here.'),
    ).toBeInTheDocument()
    cleanup()
    list.mockImplementation(async () => {
      throw new Error('Bad gateway')
    })
    renderWithProviders({ ui: <NotificationsPage /> })
    expect(await screen.findByRole('alert')).toHaveTextContent('Bad gateway')
  })
})

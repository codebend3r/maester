import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import {
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  REACHABILITY_PROBLEMS,
  REMOTE_ACCESS_STATES,
  type RemoteAccessState,
} from '@raven/core'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { RemoteAccessSection } from '@/pages/SettingsPage/RemoteAccessSection'
import { renderWithProviders } from '@/test/render'

const read = spyOn(api, 'getRemoteAccess')
const save = spyOn(api, 'setRemoteAccess')

afterEach(() => {
  cleanup()
  read.mockReset()
  save.mockReset()
})

const OFF: RemoteAccessState = {
  settings: DEFAULT_REMOTE_ACCESS_SETTINGS,
  privateAddress: 'raven.home.example',
  publicOrigin: null,
  status: { state: REMOTE_ACCESS_STATES.disabled },
}

const CONFIGURED = {
  ...DEFAULT_REMOTE_ACCESS_SETTINGS,
  isEnabled: true,
  hostname: 'raven.example.synology.me',
  publicPort: 8443,
} as const

const SEEN = {
  publicAddress: '203.0.113.9',
  resolved: ['203.0.113.9'],
  checkedAt: '2026-11-04T18:00:00.000Z',
}

const REACHABLE: RemoteAccessState = {
  settings: CONFIGURED,
  privateAddress: 'raven.home.example',
  publicOrigin: 'https://raven.example.synology.me:8443',
  status: { state: REMOTE_ACCESS_STATES.reachable, isClientAddressForwarded: true, ...SEEN },
}

const section = async () => {
  renderWithProviders({ ui: <RemoteAccessSection /> })
  return screen.findByRole('region', { name: 'Remote Access' })
}

describe('RemoteAccessSection', () => {
  it('says remote access is off and shows the way in, private first', async () => {
    read.mockResolvedValue(OFF)
    const region = await section()
    expect(await within(region).findByText('Remote access is off.')).toBeInTheDocument()
    const route = within(region).getByRole('list', { name: 'How raven is reached' })
    expect(within(route).getByText('raven.home.example:No port')).toBeInTheDocument()
    expect(within(route).getByText('Not known yet:No port')).toBeInTheDocument()
    expect(within(route).getByText('Internet')).toBeInTheDocument()
    expect(within(region).getByLabelText('Limit remote stream bitrate')).toHaveValue('original')
  })

  it('applies every field at once and shows what the check found', async () => {
    read.mockResolvedValue(OFF)
    save.mockResolvedValue(REACHABLE)
    const region = await section()
    await userEvent.click(await within(region).findByLabelText(/Enable remote access/))
    await userEvent.type(
      within(region).getByLabelText('Public hostname'),
      ' Raven.Example.Synology.me ',
    )
    await userEvent.type(within(region).getByLabelText('Manually specify public port'), '8443')
    await userEvent.type(within(region).getByLabelText('Internet upload speed (Mbps)'), '20')
    await userEvent.selectOptions(
      within(region).getByLabelText('Limit remote stream bitrate'),
      'high720',
    )
    expect(
      within(region).getByText(
        'Remote transcodes are held to 720p HD (High), 4.0 Mb/s; your upload carries 5 at once.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: 'Apply' }))
    expect(save).toHaveBeenCalledWith({
      isEnabled: true,
      hostname: 'raven.example.synology.me',
      publicPort: 8443,
      privatePort: null,
      uploadMbps: 20,
      remoteLimit: 'high720',
    })
    expect(
      await within(region).findByText('Fully accessible outside your network'),
    ).toBeInTheDocument()
    expect(within(region).getByText('203.0.113.9:8443')).toBeInTheDocument()
    expect(within(region).getByText('raven.home.example:8443')).toBeInTheDocument()
  })

  it('says why raven is not reachable, and checks again with no change', async () => {
    read.mockResolvedValue({
      ...REACHABLE,
      status: {
        state: REMOTE_ACCESS_STATES.unreachable,
        problem: REACHABILITY_PROBLEMS.timeout,
        ...SEEN,
      },
    })
    save.mockResolvedValue(REACHABLE)
    const region = await section()
    expect(
      await within(region).findByText('Not reachable outside your network'),
    ).toBeInTheDocument()
    expect(within(region).getByText(/Nothing answered in time/)).toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: 'Check again' }))
    expect(save).toHaveBeenCalledWith({})
    await waitFor(() =>
      expect(within(region).getByText('Fully accessible outside your network')).toBeInTheDocument(),
    )
  })

  it('warns when the reverse proxy forwards no client address', async () => {
    read.mockResolvedValue({
      ...REACHABLE,
      status: { state: REMOTE_ACCESS_STATES.reachable, isClientAddressForwarded: false, ...SEEN },
    })
    const region = await section()
    expect(await within(region).findByText(/Add an X-Forwarded-For header/)).toBeInTheDocument()
  })

  it('shows a refused change and a failed read', async () => {
    read.mockResolvedValue(OFF)
    save.mockRejectedValue(new Error('Each setting must be one of the values it takes.'))
    const region = await section()
    await userEvent.click(await within(region).findByRole('button', { name: 'Apply' }))
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'Could not save: Each setting must be one of the values it takes.',
    )
    cleanup()
    read.mockRejectedValue(new Error('Server unavailable'))
    const failed = await section()
    expect(await within(failed).findByRole('alert')).toHaveTextContent('Server unavailable')
  })
})

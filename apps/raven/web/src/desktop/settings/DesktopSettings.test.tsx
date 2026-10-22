import { describe, expect, it } from 'bun:test'
import {
  AUDIO_PROFILES,
  DEFAULT_OUTPUT_SETTINGS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  type OutputSettings,
  type UpdateStatus,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DesktopSettings } from '@/desktop/settings/DesktopSettings'
import { asDesktop, downloadsMain, type FakeClient, sentOfType, viewOf } from '@/test/desktop'
import { renderWithProviders } from '@/test/render'

const STATUS: UpdateStatus = {
  isEnabled: true,
  current: '1.2.0',
  checkedAt: null,
  latest: null,
  problem: null,
}

type Answer = (request: DesktopRequest) => DesktopReply | undefined

/**
 * Main for Settings: the downloads as `downloadsMain` keeps them, the sound output as written,
 * and the release check; `answer` comes first.
 */
const settingsMain = ({
  output = DEFAULT_OUTPUT_SETTINGS,
  isEngineReady = true,
  status = STATUS,
  answer = () => undefined,
}: {
  output?: OutputSettings
  isEngineReady?: boolean
  status?: UpdateStatus
  answer?: Answer
} = {}) => {
  const downloads = downloadsMain({ downloads: [viewOf()] })
  const state = { output }
  downloads.request.mockImplementation(async (request) => {
    const answered = answer(request)
    if (answered !== undefined) return answered
    switch (request.type) {
      case DESKTOP_REQUESTS.readOutput:
        return {
          type: DESKTOP_REPLIES.output,
          output: state.output,
          devices: [
            { name: 'auto', description: 'Autoselect' },
            { name: 'coreaudio/hdmi', description: 'LG TV' },
          ],
          isEngineReady,
        }
      case DESKTOP_REQUESTS.writeOutput:
        state.output = request.output
        return { type: DESKTOP_REPLIES.done }
      case DESKTOP_REQUESTS.readUpdates:
        return { type: DESKTOP_REPLIES.updates, status }
      case DESKTOP_REQUESTS.setUpdateCheck:
        return {
          type: DESKTOP_REPLIES.updates,
          status: { ...status, isEnabled: request.isEnabled },
        }
      case DESKTOP_REQUESTS.checkForUpdates:
        return { type: DESKTOP_REPLIES.updates, status: { ...status, checkedAt: 1 } }
      default:
        return downloadsMain({ downloads: [viewOf()] }).request(request)
    }
  })
  return downloads
}

const renderSettings = (client: FakeClient = settingsMain()) => {
  asDesktop(client)
  renderWithProviders({
    ui: (
      <>
        <DesktopSettings />
        <Toaster />
      </>
    ),
  })
  return client
}

const section = (name: string) => screen.getByRole('region', { name })

describe('DesktopSettings: Downloads', () => {
  it('sets what a new download starts with, and shows the folder', async () => {
    const client = renderSettings()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Delete once watched/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.setDownloadDefaults })).toEqual([
      { type: DESKTOP_REQUESTS.setDownloadDefaults, autoDelete: true },
    ])
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.showDownloadsFolder })).toHaveLength(1)
    expect(
      await screen.findByText('34.2 GB of downloads, 412.0 GB free on this Mac.'),
    ).toBeInTheDocument()
  })

  it('asks before deleting every download, and can be talked out of it', async () => {
    const client = renderSettings()
    const ask = await screen.findByRole('button', { name: 'Delete all downloads' })
    await waitFor(() => expect(ask).toBeEnabled())
    await userEvent.click(ask)
    expect(screen.getByText('Delete all downloads? 34.2 GB will be freed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Delete all downloads' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Delete all downloads' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete all downloads' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Show in Finder' })).toHaveFocus()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.deleteAllDownloads })).toHaveLength(1)
  })
})

describe('DesktopSettings: This computer', () => {
  it('saves the sound output picked, for the next video', async () => {
    const client = renderSettings()
    const sound = await screen.findByRole('group', { name: 'Sound output' })
    await userEvent.click(within(sound).getByRole('radio', { name: /Headphones/ }))
    expect(
      await screen.findByText('Sound output saved. It applies to the video you play next.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Spatial audio (AirPods)' }))
    await userEvent.selectOptions(screen.getByLabelText('Output device'), 'coreaudio/hdmi')
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.writeOutput }).at(-1)?.output).toEqual({
        ...DEFAULT_OUTPUT_SETTINGS,
        profile: AUDIO_PROFILES.headphones,
        spatial: true,
        device: 'coreaudio/hdmi',
      }),
    )
  })

  it('picks the formats a receiver decodes, and says when there are none', async () => {
    const client = renderSettings(
      settingsMain({ output: { ...DEFAULT_OUTPUT_SETTINGS, profile: AUDIO_PROFILES.passthrough } }),
    )
    expect(await screen.findByText(/Volume is set on your receiver\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Dolby Digital (AC3)' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'DTS' }))
    expect(
      await screen.findByText(/No formats chosen, so sound plays as PCM\./),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'DTS' }))
    await waitFor(() =>
      expect(
        sentOfType({ client, type: DESKTOP_REQUESTS.writeOutput }).at(-1)?.output.passthrough,
      ).toEqual(['dts']),
    )
  })

  it('waits for the video engine, and says a refused save', async () => {
    renderSettings(
      settingsMain({
        isEngineReady: false,
        answer: (request) =>
          request.type === DESKTOP_REQUESTS.writeOutput
            ? { type: DESKTOP_REPLIES.refused, message: 'mpv said no.' }
            : undefined,
      }),
    )
    expect(await screen.findByText(/video engine is not running/)).toBeInTheDocument()
    expect(screen.getByLabelText('Output device')).toBeDisabled()
    expect(screen.getByText('Device list unavailable.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Receiver passthrough/ }))
    expect(await within(section('This computer')).findByRole('alert')).toHaveTextContent(
      'mpv said no.',
    )
  })

  it('says why the sound settings could not be read', async () => {
    renderSettings(
      settingsMain({
        answer: (request) =>
          request.type === DESKTOP_REQUESTS.readOutput ? { type: DESKTOP_REPLIES.done } : undefined,
      }),
    )
    expect(await within(section('This computer')).findByRole('alert')).toHaveTextContent(
      'raven player could not read its sound settings.',
    )
  })
})

describe('DesktopSettings: Updates', () => {
  it('turns the daily check off and on, and checks now', async () => {
    const client = renderSettings()
    const daily = await screen.findByRole('checkbox', { name: /Check for updates once a day/ })
    expect(screen.getByText('This is raven player 1.2.0. Not checked yet.')).toBeInTheDocument()
    await userEvent.click(daily)
    await waitFor(() => expect(daily).not.toBeChecked())
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(await screen.findByText('raven player 1.2.0 is the newest release.')).toBeInTheDocument()
    expect(screen.getByText(/Last checked/)).toBeInTheDocument()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.setUpdateCheck })).toEqual([
      { type: DESKTOP_REQUESTS.setUpdateCheck, isEnabled: false },
    ])
  })

  it("opens a newer release's page, and says what went wrong", async () => {
    const client = renderSettings(
      settingsMain({
        status: { ...STATUS, latest: '2.0.0', problem: 'GitHub was slow.' },
        answer: (request) =>
          request.type === DESKTOP_REQUESTS.checkForUpdates
            ? { type: DESKTOP_REPLIES.refused, message: 'Offline.' }
            : undefined,
      }),
    )
    expect(await screen.findByText('raven player 2.0.0 is out.')).toBeInTheDocument()
    expect(
      screen.getByText('raven player could not check for updates. GitHub was slow.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: "See what's new" }))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.openRelease })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(await within(section('Updates')).findByRole('alert')).toHaveTextContent('Offline.')
  })

  it('says a release page that would not open, and a status it could not read', async () => {
    renderSettings(
      settingsMain({
        status: { ...STATUS, latest: '2.0.0' },
        answer: (request) =>
          request.type === DESKTOP_REQUESTS.openRelease
            ? { type: DESKTOP_REPLIES.space, space: { free: 0, total: 0, used: 0 } }
            : undefined,
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: "See what's new" }))
    expect(await within(section('Updates')).findByRole('alert')).toHaveTextContent(
      'raven player could not open the release page. Try again.',
    )
  })
})

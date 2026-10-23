import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_TARGET_KINDS,
  type DesktopReply,
  type DownloadAsk,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { usePlayerPrefs } from '@raven/ui/headless'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { useDownloadAsk } from '@/stores/downloadAsk'
import { held } from '@/test/held'
import { ASK_ID, asDesktop, fakeClient, SERVER_ID } from '@/test/desktop'
import { renderWithProviders } from '@/test/render'

const TARGET = { kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 } as const

const askOf = (): DownloadAsk => ({
  askId: ASK_ID,
  serverId: SERVER_ID,
  serverName: 'raven',
  shouldAutoDelete: false,
  status: { kind: DOWNLOAD_ASK_KINDS.locked },
})

describe('DownloadButton', () => {
  const open = spyOn(ravenPlayer, 'open').mockImplementation(() => {})

  afterEach(() => {
    open.mockClear()
  })

  it('renders nothing while this browser does not open videos in Raven', () => {
    const { container } = render(
      <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 2, tmdbId: '119' }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('marks itself wide, so the header makes room for its label', () => {
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    render(
      <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 2, tmdbId: '119' }} />,
    )
    expect(screen.getByRole('button', { name: 'Download to Raven' })).toHaveAttribute('data-wide')
  })

  it('opens the saga download link in Raven when pressed', async () => {
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    render(
      <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 2, tmdbId: '119' }} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Download to Raven' }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(
      `raven://download?server=${encodeURIComponent(window.location.origin)}&saga=2%3A119`,
    )
  })

  it('is always there inside Raven, and asks the app to download the title', async () => {
    const ask = askOf()
    const client = fakeClient({
      request: async () => ({ type: DESKTOP_REPLIES.downloadAsk, ask }),
    })
    asDesktop(client)
    renderWithProviders({ ui: <DownloadButton target={TARGET} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(client.request).toHaveBeenCalledWith({
      type: DESKTOP_REQUESTS.askDownload,
      target: TARGET,
    })
    expect(useDownloadAsk.getState().shown?.ask).toEqual(ask)
    expect(open).not.toHaveBeenCalled()
  })

  it('asks once while Raven reads the title, however often it is pressed', async () => {
    const reply = held<DesktopReply>()
    const client = fakeClient({ request: () => reply.promise })
    asDesktop(client)
    renderWithProviders({ ui: <DownloadButton target={TARGET} /> })
    const button = screen.getByRole('button', { name: 'Download' })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(client.request).toHaveBeenCalledTimes(1)
    await act(async () => reply.answer({ type: DESKTOP_REPLIES.done }))
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it("says Raven's refusal", async () => {
    asDesktop(
      fakeClient({
        request: async () => ({ type: DESKTOP_REPLIES.refused, message: 'Sign in first.' }),
      }),
    )
    renderWithProviders({
      ui: (
        <>
          <DownloadButton target={TARGET} />
          <Toaster />
        </>
      ),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(await screen.findByText('Sign in first.')).toBeInTheDocument()
  })
})

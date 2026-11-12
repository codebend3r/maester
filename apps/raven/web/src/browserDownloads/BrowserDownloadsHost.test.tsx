import {
  AUTH_CONFIG_STATES,
  DESKTOP_REQUESTS,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_KINDS,
  DOWNLOAD_TARGET_KINDS,
  CONTAINERS,
  DESKTOP_REPLIES,
  DEVICE_DOWNLOAD_STATES,
  DOWNLOAD_STATUS_KINDS,
} from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { onlineManager } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'bun:test'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserDownloadsHost } from '@/browserDownloads/BrowserDownloadsHost'
import type { BrowserDownloads } from '@/browserDownloads/engine'
import { LOCAL_ACCOUNT } from '@/browserDownloads/entries'
import { type DownloadsData } from '@/desktop/downloadsApi'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { signOut } from '@/lib/session'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { useBrowserDownloads } from '@/stores/browserDownloads'
import { useDownloadAsk } from '@/stores/downloadAsk'
import { useDownloadPreparing } from '@/stores/downloadPreparing'
import { useDownloadsHostStore } from '@/stores/downloadsHost'
import { useServerReach } from '@/stores/serverReach'
import { readyConfig } from '@/test/authClient'
import {
  ACCOUNT,
  asBrowserDownloads,
  bytesOfLength,
  fakeEngine,
  fakeServer,
  OTHER_ACCOUNT,
} from '@/test/browserDownloads'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const MOVIE = mediaItem({ id: 7, container: CONTAINERS.mkv, size: 10, item: null })

type HostedProps = {
  authConfig?: Parameters<typeof renderWithProviders>[0]['authConfig']
  account?: string | null
}

/** The host over an engine nobody is signed in to yet, so the host itself says whose downloads show. */
const hosted = async ({ authConfig, account = null }: HostedProps = {}) => {
  const server = fakeServer({
    media: [MOVIE],
    files: { 7: bytesOfLength(10) },
    copies: {
      7: [
        { state: DEVICE_DOWNLOAD_STATES.preparing, progress: 0.5 },
        { state: DEVICE_DOWNLOAD_STATES.ready, bytes: 10 },
      ],
    },
  })
  const fake = await fakeEngine({ server, account, canPlay: () => false })
  asBrowserDownloads(fake.engine)
  const rendered = renderWithProviders({
    ui: <BrowserDownloadsHost engine={fake.engine} />,
    authConfig,
  })
  return { ...fake, ...rendered }
}

const download = async (engine: BrowserDownloads) => {
  const asked = await engine.ask({ kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 })
  if (!asked.ok) throw new Error(asked.message)
  await act(async () => {
    engine.confirm(asked.value.askId)
  })
}

const signIn = (userId: string | null) =>
  act(() =>
    useAuthSession.setState({
      status: AUTH_SESSION_STATUSES.ready,
      session: userId === null ? null : { accessToken: 't', userId },
    }),
  )

describe('BrowserDownloadsHost', () => {
  afterEach(() => act(() => onlineManager.setOnline(true)))

  it('shows and runs the downloads of the one account a server without accounts has', async () => {
    const { engine, client } = await hosted()
    await download(engine)
    await waitFor(() =>
      expect(engine.list()[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.ready),
    )
    expect(engine.list()).toHaveLength(1)
    // What the engine tells lands in the cache the Downloads page reads.
    await waitFor(() =>
      expect(
        client.getQueryData<DownloadsData>(DESKTOP_QUERY_KEYS.downloads)?.downloads[0]?.status ??
          null,
      ).toEqual({ kind: DOWNLOAD_STATUS_KINDS.ready }),
    )
    engine.setAccount(LOCAL_ACCOUNT)
    expect(engine.list()).toHaveLength(1)
  })

  it("passes the server copy's progress on to the rows that wait on it", async () => {
    const { engine } = await hosted()
    const heard: number[] = []
    const stop = useDownloadPreparing.subscribe(({ progress }) =>
      heard.push(...Object.values(progress)),
    )
    await download(engine)
    await waitFor(() =>
      expect(engine.list()[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.ready),
    )
    stop()
    expect(heard).toContain(0.5)
    expect(useDownloadPreparing.getState().progress).toEqual({})
  })

  it("follows the signed-in account, and hides one account's downloads from the next", async () => {
    const { engine } = await hosted({ authConfig: readyConfig })
    expect(engine.isSettled()).toBe(true)
    await signIn(ACCOUNT)
    await download(engine)
    await waitFor(() =>
      expect(engine.list()[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.ready),
    )
    expect(useBrowserDownloads.getState().lastAccountId).toBe(ACCOUNT)
    await signIn(OTHER_ACCOUNT)
    expect(engine.list()).toEqual([])
    await signIn(null)
    expect(engine.list()).toEqual([])
  })

  it('keeps showing the last account its downloads while no server can renew its session', async () => {
    const { engine } = await hosted({ authConfig: readyConfig })
    await signIn(ACCOUNT)
    await download(engine)
    await waitFor(() =>
      expect(engine.list()[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.ready),
    )
    act(() => onlineManager.setOnline(false))
    expect(useServerReach.getState().isOffline).toBe(true)
    await signIn(null)
    expect(engine.list()).toHaveLength(1)
  })

  it('hides them once the account signs out, and keeps the files', async () => {
    const { engine, disk, client } = await hosted({ authConfig: readyConfig })
    await signIn(ACCOUNT)
    await download(engine)
    await waitFor(() =>
      expect(engine.list()[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.ready),
    )
    act(() => onlineManager.setOnline(false))
    await act(async () => {
      await signOut({ queryClient: client })
      client.setQueryData(queryKeys.authConfig, readyConfig)
    })
    await signIn(null)
    expect(useBrowserDownloads.getState().lastAccountId).toBeNull()
    expect(engine.list()).toEqual([])
    expect(disk.names().some((name) => name.endsWith('media.mp4'))).toBe(true)
  })

  it('shows nobody downloads while the server has not said how its accounts stand', async () => {
    const { engine } = await hosted({ authConfig: { state: AUTH_CONFIG_STATES.unavailable } })
    await signIn(ACCOUNT)
    expect(engine.isSettled()).toBe(true)
    const asked = await engine.ask({ kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 })
    expect(asked).toMatchObject({
      ok: true,
      value: { status: { kind: DOWNLOAD_ASK_KINDS.account } },
    })
  })

  it('goes offline with the device, and queues again what the lost connection stopped', async () => {
    const { engine, server } = await hosted()
    server.answers.push(new TypeError('Failed to fetch'))
    await download(engine)
    await waitFor(() =>
      expect(engine.list()[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.paused),
    )
    act(() => onlineManager.setOnline(false))
    expect(useServerReach.getState().isOffline).toBe(true)
    act(() => onlineManager.setOnline(true))
    expect(useServerReach.getState().isOffline).toBe(false)
    await waitFor(() =>
      expect(engine.list()[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.ready),
    )
  })

  it('shows the download dialog in the words of a browser, and declines an ask left unanswered', async () => {
    const { engine } = await hosted()
    const host = useDownloadsHostStore.getState().host
    const asked = await engine.ask({ kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 })
    if (!asked.ok || host === null) throw new Error('The engine did not ask.')
    act(() => useDownloadAsk.getState().show(asked.value))
    const dialog = await screen.findByRole('dialog', { name: 'Download to this browser' })
    expect(dialog).toHaveTextContent(/free in this browser\. It downloads while raven is open/)
    // A browser deletes nothing by itself, so the dialog offers no such switch.
    expect(screen.queryByRole('checkbox', { name: 'Delete once watched' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(useDownloadAsk.getState().shown).toBeNull())
    expect(
      await host.request({
        type: DESKTOP_REQUESTS.confirmDownload,
        askId: asked.value.askId,
        shouldAutoDelete: false,
      }),
    ).toMatchObject({ type: DESKTOP_REPLIES.refused })
    expect(asked.value.status).toMatchObject({
      kind: DOWNLOAD_ASK_KINDS.ready,
      downloadKind: DOWNLOAD_KINDS.movie,
    })
  })
})

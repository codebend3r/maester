import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopEvent,
  type DesktopReply,
  type DesktopRequest,
  type DownloadView,
  type SpaceView,
  DESKTOP_PLATFORMS,
  DOWNLOAD_STATUS_KINDS,
  DOWNLOAD_KINDS,
  PLAYER_CONNECTION_STATUSES,
  type PlayerEvent,
} from '@raven/core'
import type { NativePlayer } from '@raven/ui/headless'
import { mock } from 'bun:test'
import { act } from '@testing-library/react'
import type { DesktopClient } from '@/desktop/client'
import { createMenuHub } from '@/desktop/menuHub'
import type { AudioConnection, AudioConnections } from '@/desktop/audioConnection'
import type { PlayerConnection, PlayerConnections } from '@/desktop/playerConnection'
import type { Connection, Connections } from '@/desktop/portConnection'
import { useDesktopBridge } from '@/stores/desktop'

export const GB = 1_000_000_000

export const DL_1 = '0a000000-0000-4000-8000-000000000001'
export const DL_2 = '0a000000-0000-4000-8000-000000000002'
export const DL_3 = '0a000000-0000-4000-8000-000000000003'
export const SERVER_ID = '0b000000-0000-4000-8000-000000000001'
export const ASK_ID = '0c000000-0000-4000-8000-000000000001'
export const FILE_ID = '0d000000-0000-4000-8000-000000000001'
export const RECENT_ID = '0e000000-0000-4000-8000-000000000001'

const SPACE: SpaceView = { free: 412 * GB, total: 1000 * GB, used: 34.2 * GB }

const DONE = { type: DESKTOP_REPLIES.done } as const satisfies DesktopReply

/** An episode of Severance, queued unless `overrides` say otherwise. */
export const viewOf = (overrides: Partial<DownloadView> = {}): DownloadView => ({
  downloadId: DL_1,
  serverId: SERVER_ID,
  label: 'S01E01 Good News',
  group: { kind: DOWNLOAD_KINDS.season, key: 'show:4', title: 'Severance', order: 10_001 },
  serverName: 'raven',
  size: 2 * GB,
  status: { kind: DOWNLOAD_STATUS_KINDS.queued },
  shouldAutoDelete: false,
  watched: null,
  deletesAt: null,
  isLocked: false,
  ...overrides,
})

/** A client whose calls are recorded; `emit` pushes an event to whoever subscribed. */
type FakeClientProps = Partial<Pick<DesktopClient, 'request' | 'dropFiles' | 'platform'>>

export const fakeClient = ({
  request = async () => DONE,
  dropFiles = async () => DONE,
  platform = DESKTOP_PLATFORMS.mac,
}: FakeClientProps = {}) => {
  const listeners = new Set<(event: DesktopEvent) => void>()
  return {
    platform,
    request: mock<DesktopClient['request']>(request),
    dropFiles: mock<DesktopClient['dropFiles']>(dropFiles),
    subscribe: mock<DesktopClient['subscribe']>((listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }),
    emit: (event: DesktopEvent) =>
      act(() => {
        listeners.forEach((listener) => listener(event))
      }),
  }
}

export type FakeClient = ReturnType<typeof fakeClient>

/** A connection to one of main's engines that changes only when the test says so. */
const settableConnectionsOf = <C, E>(initial: Connection<C, E>) => {
  const listeners = new Set<() => void>()
  let connection = initial
  return {
    read: () => connection,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (next: Connection<C, E>) =>
      act(() => {
        connection = next
        listeners.forEach((listener) => listener())
      }),
  } satisfies Connections<C, E> & { set: (next: Connection<C, E>) => void }
}

/** A player connection that changes only when the test says so. */
export const connectionsOf = (
  initial: PlayerConnection,
): PlayerConnections & { set: (next: PlayerConnection) => void } => settableConnectionsOf(initial)

/** A music engine connection that changes only when the test says so. */
export const audioConnectionsOf = (
  initial: AudioConnection,
): AudioConnections & { set: (next: AudioConnection) => void } => settableConnectionsOf(initial)

/** No video engine, as main says when mpv did not start. */
const NO_ENGINE: PlayerConnection = {
  status: PLAYER_CONNECTION_STATUSES.unavailable,
  message: 'The video engine is off for this test.',
}

/** No music engine either, so music plays through the page's own host. */
const NO_MUSIC_ENGINE: AudioConnection = {
  status: PLAYER_CONNECTION_STATUSES.unavailable,
  message: 'The music engine is off for this test.',
}

type AsPlayingDesktopProps = {
  client?: DesktopClient
  player?: PlayerConnections
  audio?: AudioConnections
}

/** Runs the page as Raven's, as `startDesktop` sets it: its bridge is `client`, `player` and `audio`. */
export const asPlayingDesktop = ({
  client = fakeClient(),
  player = connectionsOf(NO_ENGINE),
  audio = audioConnectionsOf(NO_MUSIC_ENGINE),
}: AsPlayingDesktopProps) => {
  const menu = createMenuHub()
  useDesktopBridge.setState({ desktop: { client, menu, player, audio } })
  return { client, menu, player, audio }
}

/** Runs the page as Raven's with no video engine: its bridge is `client`. */
export const asDesktop = (client: DesktopClient = fakeClient()) => asPlayingDesktop({ client })

/** A native player whose commands are recorded and answered at once; `emit` plays main's events. */
export const fakePlayer = () => {
  const listeners = new Set<(event: PlayerEvent) => void>()
  const send = mock<NativePlayer['send']>(async () => {})
  const player: NativePlayer = {
    send,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    player,
    send,
    emit: (event: PlayerEvent) =>
      act(() => {
        listeners.forEach((listener) => listener(event))
      }),
  }
}

/** Lets the page's promises and timers of `ms` run. */
export const settled = (ms = 10) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })

type SentOfTypeProps<T extends DesktopRequest['type']> = {
  client: FakeClient
  type: T
}

/** The requests of `type` the page sent, in order. */
export const sentOfType = <T extends DesktopRequest['type']>({
  client,
  type,
}: SentOfTypeProps<T>): Extract<DesktopRequest, { type: T }>[] =>
  client.request.mock.calls
    .map(([request]) => request)
    .filter((request): request is Extract<DesktopRequest, { type: T }> => request.type === type)

type Answers = Partial<Record<DesktopRequest['type'], DesktopReply>>

type DownloadsMainProps = {
  downloads?: DownloadView[]
  shouldAutoDelete?: boolean
  space?: SpaceView
  answers?: Answers
}

/**
 * Main as the downloads screens see it: it keeps the list and answers each change with the new
 * one, or with `answers` by request type.
 */
export const downloadsMain = ({
  downloads = [],
  shouldAutoDelete = false,
  space = SPACE,
  answers = {},
}: DownloadsMainProps = {}) => {
  const state = { downloads, shouldAutoDelete }
  const listed = (): DesktopReply => ({
    type: DESKTOP_REPLIES.downloads,
    downloads: state.downloads,
    shouldAutoDeleteByDefault: state.shouldAutoDelete,
  })
  type UpdateProps = {
    downloadId: string
    change: (view: DownloadView) => DownloadView
  }

  const update = ({ downloadId, change }: UpdateProps): DesktopReply => {
    state.downloads = state.downloads.map((view) =>
      view.downloadId === downloadId ? change(view) : view,
    )
    return listed()
  }
  const respond = (request: DesktopRequest): DesktopReply => {
    const answer = answers[request.type]
    if (answer !== undefined) return answer
    switch (request.type) {
      case DESKTOP_REQUESTS.listDownloads:
        return listed()
      case DESKTOP_REQUESTS.readSpace:
        return { type: DESKTOP_REPLIES.space, space }
      case DESKTOP_REQUESTS.listRecents:
        return { type: DESKTOP_REPLIES.recents, recents: [] }
      case DESKTOP_REQUESTS.pauseDownload:
        return update({
          downloadId: request.downloadId,
          change: (view) => ({
            ...view,
            status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 0, message: null },
          }),
        })
      case DESKTOP_REQUESTS.resumeDownload:
      case DESKTOP_REQUESTS.retryDownload:
        return update({
          downloadId: request.downloadId,
          change: (view) => ({
            ...view,
            status: { kind: DOWNLOAD_STATUS_KINDS.queued },
            isLocked: false,
          }),
        })
      case DESKTOP_REQUESTS.setDownloadAutoDelete:
        return update({
          downloadId: request.downloadId,
          change: (view) => ({ ...view, shouldAutoDelete: request.shouldAutoDelete }),
        })
      case DESKTOP_REQUESTS.deleteDownload:
        state.downloads = state.downloads.filter((view) => view.downloadId !== request.downloadId)
        return listed()
      case DESKTOP_REQUESTS.deleteAllDownloads:
        state.downloads = []
        return listed()
      case DESKTOP_REQUESTS.setDownloadDefaults:
        state.shouldAutoDelete = request.shouldAutoDelete
        return listed()
      default:
        return DONE
    }
  }
  return fakeClient({ request: async (request) => respond(request) })
}

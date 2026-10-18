import { describe, expect, it } from 'bun:test'
import {
  APP_HOST,
  APP_ORIGIN,
  APP_SCHEME,
  DESKTOP_EVENTS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  ENVELOPE_KINDS,
  FILE_SCHEME,
  IPC_CHANNELS,
  MAX_QUEUE,
  MENU_PLAYER_ACTIONS,
  NAVIGATION_TARGETS,
  PLAYER_CONNECTION_STATUSES,
  SERVER_METHODS,
  WINDOW_MESSAGE_TYPES,
  fileUrlFor,
  isDesktopEvent,
  isDesktopReply,
  isDesktopRequest,
  isContainerName,
  isDownloadAsk,
  isDownloadAskStatus,
  isDownloadGroup,
  isDownloadKind,
  isDownloadStatus,
  isDownloadView,
  isInvokeEnvelope,
  isLocalFile,
  isMenuPlayerAction,
  isOpaqueId,
  isPlayerConnection,
  isPlayerPortMessage,
  isPlayTarget,
  isRecentView,
  isServerMethod,
  isServerTarget,
  isServerView,
  isSidecarTrackId,
  isSpaceView,
  isTrackChoice,
  isUpdateStatus,
} from '@/shared/protocol'

const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
const other = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

const READY = {
  kind: 'ready',
  title: 'The Lord of the Rings Collection',
  downloadKind: 'saga',
  files: 3,
  bytes: 44_236_810_240,
  free: 442_381_631_488,
  fits: true,
} as const

const ASK = { askId: id, serverId: other, serverName: 'Vhagar', autoDelete: false, status: READY }

const VIEW = {
  downloadId: id,
  serverId: other,
  label: 'The Two Towers (2002)',
  group: {
    kind: 'saga',
    key: 'saga:1:119',
    title: 'The Lord of the Rings Collection',
    order: 1,
  },
  serverName: 'Vhagar',
  size: 15_891_378_995,
  status: { kind: 'downloading', bytes: 12_992_272_384 },
  autoDelete: true,
  watched: null,
  deletesAt: null,
  needsUnlock: false,
} as const

const UPDATES = {
  isEnabled: true,
  current: '0.5.4',
  checkedAt: null,
  latest: null,
  problem: 'GitHub did not answer.',
} as const

describe('constants', () => {
  it('names the app origin, the file scheme and the two channels', () => {
    expect(APP_ORIGIN).toBe('app://raven')
    expect(`${APP_SCHEME}://${APP_HOST}`).toBe(APP_ORIGIN)
    expect(FILE_SCHEME).toBe('raven-file')
    expect(IPC_CHANNELS).toEqual({
      request: 'raven:request',
      event: 'raven:event',
      player: 'raven:player',
    })
    expect(MAX_QUEUE).toBe(100)
    expect(WINDOW_MESSAGE_TYPES.playerPort).toBe('raven:player-port')
  })
})

describe('isOpaqueId', () => {
  it('accepts what crypto.randomUUID returns', () => {
    expect(isOpaqueId(crypto.randomUUID())).toBe(true)
  })

  it.each([
    ['uppercase', 'ABCDEF00-0000-4000-8000-000000000000'],
    ['a path', '../etc'],
    ['an empty string', ''],
    ['a number', 42],
    ['a null', null],
  ])('rejects %s', (_name, value) => {
    expect(isOpaqueId(value)).toBe(false)
  })
})

describe('fileUrlFor', () => {
  it('puts the id behind the file scheme', () => {
    expect(fileUrlFor(id)).toBe(`raven-file://${id}`)
  })
})

describe('the building blocks', () => {
  it('accepts a play target, a local file, a recent view and a menu action', () => {
    expect(isPlayTarget({ fileId: id, queue: [id, other] })).toBe(true)
    expect(
      isLocalFile({
        fileId: id,
        label: 'film.mkv',
        folder: 'Movies',
        resumeAt: 12,
        next: { fileId: other, label: 'next.mkv', queue: [other] },
        tracks: { audio: 1, subtitle: 'embedded-0' },
      }),
    ).toBe(true)
    expect(
      isLocalFile({
        fileId: id,
        label: 'film.mkv',
        folder: 'Movies',
        resumeAt: 0,
        next: null,
        tracks: null,
      }),
    ).toBe(true)
    expect(isRecentView({ recentId: id, label: 'film.mkv', from: 'Movies', watched: null })).toBe(
      true,
    )
    expect(isRecentView({ recentId: id, label: 'film.mkv', from: 'Movies', watched: 0.5 })).toBe(
      true,
    )
    expect(isMenuPlayerAction.values).toEqual([
      'togglePlay',
      'skipBack',
      'skipForward',
      'next',
      'showShortcuts',
      'stats',
    ])
  })

  it('rejects ids that are not opaque and unknown actions', () => {
    expect(isPlayTarget({ fileId: '/Users/me/film.mkv', queue: [] })).toBe(false)
    expect(isPlayTarget({ fileId: id, queue: ['/Users/me/next.mkv'] })).toBe(false)
    expect(isRecentView({ recentId: 'abc', label: 'a', from: 'b', watched: null })).toBe(false)
    expect(isMenuPlayerAction('devtools')).toBe(false)
  })

  it('accepts a track choice with either side empty and rejects a mistyped one', () => {
    expect(isTrackChoice({ audio: null, subtitle: null })).toBe(true)
    expect(isTrackChoice({ audio: 2, subtitle: 'sidecar-1' })).toBe(true)
    expect(isTrackChoice({ audio: '2', subtitle: null })).toBe(false)
    expect(isTrackChoice({ audio: 2 })).toBe(false)
  })

  it('rejects a local file without its track pick', () => {
    expect(
      isLocalFile({ fileId: id, label: 'film.mkv', folder: 'Movies', resumeAt: 0, next: null }),
    ).toBe(false)
  })
})

describe('isDesktopRequest', () => {
  it.each([
    [{ type: DESKTOP_REQUESTS.ready }],
    [{ type: DESKTOP_REQUESTS.openDialog }],
    [{ type: DESKTOP_REQUESTS.describeFile, fileId: id, queue: [other] }],
    [{ type: DESKTOP_REQUESTS.savePosition, fileId: id, position: 12.5, duration: 600 }],
    [{ type: DESKTOP_REQUESTS.savePosition, fileId: id, position: 12.5, duration: null }],
    [{ type: DESKTOP_REQUESTS.listRecents }],
    [{ type: DESKTOP_REQUESTS.openRecent, recentId: id }],
    [{ type: DESKTOP_REQUESTS.removeRecent, recentId: id }],
    [{ type: DESKTOP_REQUESTS.clearRecents }],
    [{ type: DESKTOP_REQUESTS.saveTracks, fileId: id, audio: 1, subtitle: 'embedded-0' }],
    [{ type: DESKTOP_REQUESTS.saveTracks, fileId: id, audio: null, subtitle: null }],
    [{ type: DESKTOP_REQUESTS.saveTracks, fileId: id, audio: 0, subtitle: null }],
    [{ type: DESKTOP_REQUESTS.windowButtons, isVisible: false }],
    [{ type: DESKTOP_REQUESTS.readOutput }],
    [
      {
        type: DESKTOP_REQUESTS.writeOutput,
        output: { profile: 'pcm', device: 'auto', passthrough: ['ac3'], spatial: false },
      },
    ],
    [
      {
        type: DESKTOP_REQUESTS.serverCall,
        serverId: id,
        method: SERVER_METHODS.get,
        path: '/api/media/7',
        body: null,
      },
    ],
    [
      {
        type: DESKTOP_REQUESTS.serverCall,
        serverId: id,
        method: SERVER_METHODS.put,
        path: '/api/media/7/progress',
        body: '{}',
      },
    ],
    [{ type: DESKTOP_REQUESTS.listServers }],
    [{ type: DESKTOP_REQUESTS.addServer, origin: 'https://raven.example' }],
    [{ type: DESKTOP_REQUESTS.renameServer, serverId: id, name: 'Home' }],
    [{ type: DESKTOP_REQUESTS.removeServer, serverId: id }],
    [
      {
        type: DESKTOP_REQUESTS.openLink,
        link: 'raven://play?server=https://raven.example&media=7',
      },
    ],
    [{ type: DESKTOP_REQUESTS.openInBrowser, serverId: id, mediaId: 7 }],
    [
      {
        type: DESKTOP_REQUESTS.noteServerTitle,
        serverId: id,
        mediaId: 7,
        label: 'Dune',
        watched: 0.5,
      },
    ],
    [
      {
        type: DESKTOP_REQUESTS.noteServerTitle,
        serverId: id,
        mediaId: 7,
        label: 'Dune',
        watched: null,
      },
    ],
    [{ type: DESKTOP_REQUESTS.readUpdates }],
    [{ type: DESKTOP_REQUESTS.setUpdateCheck, isEnabled: false }],
    [{ type: DESKTOP_REQUESTS.checkForUpdates }],
    [{ type: DESKTOP_REQUESTS.openRelease }],
    [{ type: DESKTOP_REQUESTS.confirmDownload, askId: id, autoDelete: true }],
    [{ type: DESKTOP_REQUESTS.declineDownload, askId: id }],
    [{ type: DESKTOP_REQUESTS.retryDownloadAsk, askId: id }],
    [{ type: DESKTOP_REQUESTS.listDownloads }],
    [{ type: DESKTOP_REQUESTS.openDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.pauseDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.resumeDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.retryDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.deleteDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.setDownloadAutoDelete, downloadId: id, autoDelete: false }],
    [{ type: DESKTOP_REQUESTS.pauseAllDownloads }],
    [{ type: DESKTOP_REQUESTS.resumeAllDownloads }],
    [{ type: DESKTOP_REQUESTS.deleteAllDownloads }],
    [{ type: DESKTOP_REQUESTS.readSpace }],
    [{ type: DESKTOP_REQUESTS.setDownloadDefaults, autoDelete: true }],
    [{ type: DESKTOP_REQUESTS.showDownloadsFolder }],
  ])('accepts %j', (value) => {
    expect(isDesktopRequest(value)).toBe(true)
  })

  it.each([
    [
      'a path as the file id',
      { type: DESKTOP_REQUESTS.describeFile, fileId: '/Users/me/film.mkv', queue: [] },
    ],
    [
      'a string position',
      { type: DESKTOP_REQUESTS.savePosition, fileId: id, position: '12', duration: null },
    ],
    ['a missing duration', { type: DESKTOP_REQUESTS.savePosition, fileId: id, position: 12 }],
    [
      'a string audio index',
      { type: DESKTOP_REQUESTS.saveTracks, fileId: id, audio: '1', subtitle: null },
    ],
    [
      'a fractional audio index',
      { type: DESKTOP_REQUESTS.saveTracks, fileId: id, audio: 1.5, subtitle: null },
    ],
    [
      'a negative audio index',
      { type: DESKTOP_REQUESTS.saveTracks, fileId: id, audio: -1, subtitle: null },
    ],
    [
      'a path in saveTracks',
      { type: DESKTOP_REQUESTS.saveTracks, fileId: '/m/a.mkv', audio: 1, subtitle: null },
    ],
    ['a string for the window buttons', { type: DESKTOP_REQUESTS.windowButtons, isVisible: 'yes' }],
    ['partial output settings', { type: DESKTOP_REQUESTS.writeOutput, output: { profile: 'pcm' } }],
    [
      'a server call with a method off the list',
      {
        type: DESKTOP_REQUESTS.serverCall,
        serverId: id,
        method: 'DELETE',
        path: '/api/media/7',
        body: null,
      },
    ],
    [
      'a server call naming a host for the server',
      {
        type: DESKTOP_REQUESTS.serverCall,
        serverId: 'vhagar',
        method: SERVER_METHODS.get,
        path: '/api/media/7',
        body: null,
      },
    ],
    [
      'a server call with a number for its body',
      {
        type: DESKTOP_REQUESTS.serverCall,
        serverId: id,
        method: SERVER_METHODS.post,
        path: '/api/media/7/plays',
        body: 3,
      },
    ],
    [
      'a browser open with a media id of zero',
      { type: DESKTOP_REQUESTS.openInBrowser, serverId: id, mediaId: 0 },
    ],
    [
      'a browser open with a string media id',
      { type: DESKTOP_REQUESTS.openInBrowser, serverId: id, mediaId: '7' },
    ],
    [
      'a server title noted without its share watched',
      { type: DESKTOP_REQUESTS.noteServerTitle, serverId: id, mediaId: 7, label: 'Dune' },
    ],
    ['a server added without an origin', { type: DESKTOP_REQUESTS.addServer }],
    ['a rename to a number', { type: DESKTOP_REQUESTS.renameServer, serverId: id, name: 7 }],
    [
      'an update switch set by a string',
      { type: DESKTOP_REQUESTS.setUpdateCheck, isEnabled: 'true' },
    ],
    ['an update switch with no value', { type: DESKTOP_REQUESTS.setUpdateCheck }],
    ['a confirmation without its choice', { type: DESKTOP_REQUESTS.confirmDownload, askId: id }],
    [
      'a confirmation naming its ask by a path',
      { type: DESKTOP_REQUESTS.confirmDownload, askId: '/Users/me/film.mkv', autoDelete: false },
    ],
    ['a retry naming its ask by a number', { type: DESKTOP_REQUESTS.retryDownloadAsk, askId: 7 }],
    [
      'a download named by its path',
      {
        type: DESKTOP_REQUESTS.openDownload,
        downloadId: '/Users/me/Library/raven/downloads/a/7/video.mkv',
      },
    ],
    ['a delete with no download', { type: DESKTOP_REQUESTS.deleteDownload }],
    [
      'an auto-delete switch set by a string',
      { type: DESKTOP_REQUESTS.setDownloadAutoDelete, downloadId: id, autoDelete: 'yes' },
    ],
    ['a default with no value', { type: DESKTOP_REQUESTS.setDownloadDefaults }],
    ['an unknown type', { type: 'readFile', path: '/etc/hosts' }],
    ['no type', {}],
    ['a string', DESKTOP_REQUESTS.ready],
  ])('rejects %s', (_name, value) => {
    expect(isDesktopRequest(value)).toBe(false)
  })
})

describe('isDesktopReply', () => {
  it.each([
    [{ type: DESKTOP_REPLIES.play, target: { fileId: id, queue: [] } }],
    [
      {
        type: DESKTOP_REPLIES.file,
        file: {
          fileId: id,
          label: 'a.mkv',
          folder: 'Movies',
          resumeAt: 0,
          next: null,
          tracks: null,
        },
      },
    ],
    [
      {
        type: DESKTOP_REPLIES.output,
        output: { profile: 'passthrough', device: 'auto', passthrough: ['dts'], spatial: false },
        devices: [{ name: 'coreaudio/abc', description: 'Receiver' }],
        isEngineReady: true,
      },
    ],
    [
      {
        type: DESKTOP_REPLIES.recents,
        recents: [{ recentId: id, label: 'a', from: 'b', watched: 0.25 }],
      },
    ],
    [{ type: DESKTOP_REPLIES.recents, recents: [] }],
    [{ type: DESKTOP_REPLIES.done }],
    [{ type: DESKTOP_REPLIES.refused, message: 'no such file' }],
    [
      {
        type: DESKTOP_REPLIES.playServer,
        target: { serverId: id, mediaId: 7, at: 30, next: [8, 9] },
      },
    ],
    [{ type: DESKTOP_REPLIES.serverReply, status: 200, body: '{"state":"off"}' }],
    [
      {
        type: DESKTOP_REPLIES.serverUnreachable,
        message: 'raven player could not reach raven.example.',
      },
    ],
    [
      {
        type: DESKTOP_REPLIES.servers,
        servers: [{ serverId: id, origin: 'https://raven.example', name: 'Home' }],
      },
    ],
    [{ type: DESKTOP_REPLIES.servers, servers: [] }],
    [{ type: DESKTOP_REPLIES.updates, status: UPDATES }],
    [
      {
        type: DESKTOP_REPLIES.updates,
        status: { ...UPDATES, checkedAt: 1_700_000_000_000, latest: '0.6.0', problem: null },
      },
    ],
    [{ type: DESKTOP_REPLIES.downloadAsk, ask: ASK }],
    [{ type: DESKTOP_REPLIES.downloadAsk, ask: { ...ASK, status: { kind: 'locked' } } }],
    [
      {
        type: DESKTOP_REPLIES.downloadAsk,
        ask: { ...ASK, autoDelete: true, status: { kind: 'hidden' } },
      },
    ],
    [{ type: DESKTOP_REPLIES.downloads, downloads: [VIEW], autoDeleteDefault: false }],
    [{ type: DESKTOP_REPLIES.downloads, downloads: [], autoDeleteDefault: true }],
    [
      {
        type: DESKTOP_REPLIES.space,
        space: { free: 442_381_631_488, total: 994_662_584_320, used: 0 },
      },
    ],
  ])('accepts %j', (value) => {
    expect(isDesktopReply(value)).toBe(true)
  })

  it.each([
    [
      'an ask named by a path',
      { type: DESKTOP_REPLIES.downloadAsk, ask: { ...ASK, askId: '/tmp/ask' } },
    ],
    [
      'an ask naming its server by its origin',
      { type: DESKTOP_REPLIES.downloadAsk, ask: { ...ASK, serverId: 'https://raven.example' } },
    ],
    [
      'an ask whose ready status lacks whether it fits',
      { type: DESKTOP_REPLIES.downloadAsk, ask: { ...ASK, status: { ...READY, fits: undefined } } },
    ],
    [
      'an ask of an unknown status',
      { type: DESKTOP_REPLIES.downloadAsk, ask: { ...ASK, status: { kind: 'unlocked' } } },
    ],
    [
      'an ask without its default',
      { type: DESKTOP_REPLIES.downloadAsk, ask: { ...ASK, autoDelete: undefined } },
    ],
    [
      'a download named by its path',
      {
        type: DESKTOP_REPLIES.downloads,
        downloads: [{ ...VIEW, downloadId: '/Users/me/Library/raven/downloads/a/7/video.mkv' }],
        autoDeleteDefault: false,
      },
    ],
    ['a list without its default', { type: DESKTOP_REPLIES.downloads, downloads: [] }],
    [
      'a space without what downloads use',
      { type: DESKTOP_REPLIES.space, space: { free: 1, total: 2 } },
    ],
  ])('rejects %s', (_name, value) => {
    expect(isDesktopReply(value)).toBe(false)
  })

  it('rejects a server reply without a status and a server list holding a bare origin', () => {
    expect(isDesktopReply({ type: DESKTOP_REPLIES.serverReply, body: '' })).toBe(false)
    expect(isDesktopReply({ type: DESKTOP_REPLIES.serverUnreachable })).toBe(false)
    expect(
      isDesktopReply({ type: DESKTOP_REPLIES.servers, servers: ['https://raven.example'] }),
    ).toBe(false)
  })

  it('rejects an update status whose latest is a number or that lacks a field', () => {
    expect(
      isDesktopReply({ type: DESKTOP_REPLIES.updates, status: { ...UPDATES, latest: 3 } }),
    ).toBe(false)
    expect(
      isDesktopReply({ type: DESKTOP_REPLIES.updates, status: { ...UPDATES, isEnabled: 'yes' } }),
    ).toBe(false)
    expect(isDesktopReply({ type: DESKTOP_REPLIES.updates })).toBe(false)
    expect(
      isUpdateStatus({ isEnabled: true, current: '0.5.4', checkedAt: null, latest: null }),
    ).toBe(false)
    expect(isUpdateStatus(UPDATES)).toBe(true)
  })

  it('rejects a refusal without a message and an unknown type', () => {
    expect(isDesktopReply({ type: DESKTOP_REPLIES.refused })).toBe(false)
    expect(
      isDesktopReply({
        type: DESKTOP_REPLIES.output,
        output: { profile: 'pcm', device: 'auto', passthrough: [], spatial: false },
        devices: [{ name: 'a' }],
        isEngineReady: true,
      }),
    ).toBe(false)
    expect(isDesktopReply({ type: 'exec' })).toBe(false)
  })
})

describe('isServerTarget', () => {
  it('accepts a server id, a media id, a start and a queue of media ids', () => {
    expect(isServerTarget({ serverId: id, mediaId: 7, at: 0, next: [] })).toBe(true)
  })

  it.each([
    ['a server id that is not opaque', { serverId: 'raven.example', mediaId: 7, at: 0, next: [] }],
    ['a media id of zero', { serverId: id, mediaId: 0, at: 0, next: [] }],
    ['a fractional media id', { serverId: id, mediaId: 1.5, at: 0, next: [] }],
    ['a start that is not a number', { serverId: id, mediaId: 7, at: '30', next: [] }],
    ['a start of x', { serverId: id, mediaId: 7, at: 'x', next: [] }],
    ['a queue holding a negative id', { serverId: id, mediaId: 7, at: 0, next: [-1] }],
    ['no queue', { serverId: id, mediaId: 7, at: 0 }],
  ])('rejects %s', (_name, value) => {
    expect(isServerTarget(value)).toBe(false)
    expect(isDesktopReply({ type: DESKTOP_REPLIES.playServer, target: value })).toBe(false)
  })
})

describe('isServerMethod and isServerView', () => {
  it('names the three methods a server call may use', () => {
    expect(isServerMethod.values).toEqual(['GET', 'PUT', 'POST'])
    expect(isServerMethod('DELETE')).toBe(false)
    expect(isServerMethod('get')).toBe(false)
  })

  it('accepts a server by its id, origin and name, and rejects one named by its host', () => {
    expect(isServerView({ serverId: id, origin: 'https://raven.example', name: 'Home' })).toBe(true)
    expect(
      isServerView({ serverId: 'raven.example', origin: 'https://raven.example', name: 'a' }),
    ).toBe(false)
    expect(isServerView({ serverId: id, origin: 'https://raven.example' })).toBe(false)
  })
})

describe('isDesktopEvent', () => {
  it.each([
    [{ type: DESKTOP_EVENTS.play, target: { fileId: id, queue: [] } }],
    [{ type: DESKTOP_EVENTS.player, action: MENU_PLAYER_ACTIONS.togglePlay }],
    [{ type: DESKTOP_EVENTS.player, action: MENU_PLAYER_ACTIONS.stats }],
    [{ type: DESKTOP_EVENTS.navigate, to: NAVIGATION_TARGETS.settings }],
    [{ type: DESKTOP_EVENTS.notice, message: 'raven links open in a later release' }],
    [{ type: DESKTOP_EVENTS.playServer, target: { serverId: id, mediaId: 7, at: 30, next: [8] } }],
    [{ type: DESKTOP_EVENTS.openLink }],
    [{ type: DESKTOP_EVENTS.updateAvailable, version: '0.6.0' }],
    [{ type: DESKTOP_EVENTS.downloadAsk, ask: ASK }],
    [{ type: DESKTOP_EVENTS.downloads, downloads: [VIEW], autoDeleteDefault: false }],
  ])('accepts %j', (value) => {
    expect(isDesktopEvent(value)).toBe(true)
  })

  it.each([
    ['navigating to devtools', { type: DESKTOP_EVENTS.navigate, to: 'devtools' }],
    ['navigating home, which nothing in main sends', { type: DESKTOP_EVENTS.navigate, to: 'home' }],
    ['recentsChanged, which nothing in main sends', { type: 'recentsChanged' }],
    ['a notice without a message', { type: DESKTOP_EVENTS.notice }],
    ['a newer release without its version', { type: DESKTOP_EVENTS.updateAvailable }],
    [
      'a newer release with a number for its version',
      { type: DESKTOP_EVENTS.updateAvailable, version: 6 },
    ],
    ['openRecent, which only the page asks for', { type: DESKTOP_REQUESTS.openRecent }],
    [
      'space, which only the page asks for',
      { type: DESKTOP_REPLIES.space, space: { free: 1, total: 2, used: 0 } },
    ],
    [
      'a list of downloads without its default',
      { type: DESKTOP_EVENTS.downloads, downloads: [VIEW] },
    ],
    [
      'a server title queueing a fractional id',
      { type: DESKTOP_EVENTS.playServer, target: { serverId: id, mediaId: 7, at: 0, next: [1.5] } },
    ],
  ])('rejects %s', (_name, value) => {
    expect(isDesktopEvent(value)).toBe(false)
  })
})

describe('isInvokeEnvelope', () => {
  it.each([
    [{ kind: ENVELOPE_KINDS.page, request: { type: DESKTOP_REQUESTS.ready } }],
    [{ kind: ENVELOPE_KINDS.page, request: { type: DESKTOP_REQUESTS.openRecent, recentId: id } }],
    [{ kind: ENVELOPE_KINDS.drop, paths: ['/Users/me/film.mkv', '/Users/me/next.mkv'] }],
    [{ kind: ENVELOPE_KINDS.drop, paths: [] }],
  ])('accepts %j', (value) => {
    expect(isInvokeEnvelope(value)).toBe(true)
  })

  it.each([
    [
      'a page request off the list',
      { kind: ENVELOPE_KINDS.page, request: { type: 'readFile', path: '/etc/hosts' } },
    ],
    ['a drop of numbers', { kind: ENVELOPE_KINDS.drop, paths: [1] }],
    ['an unknown kind', { kind: 'shell', command: 'ls' }],
    ['a bare request', { type: DESKTOP_REQUESTS.ready }],
  ])('rejects %s', (_name, value) => {
    expect(isInvokeEnvelope(value)).toBe(false)
  })
})

describe('isPlayerPortMessage', () => {
  it.each([
    [
      {
        type: WINDOW_MESSAGE_TYPES.playerPort,
        connection: { status: PLAYER_CONNECTION_STATUSES.native },
      },
    ],
    [
      {
        type: WINDOW_MESSAGE_TYPES.playerPort,
        connection: {
          status: PLAYER_CONNECTION_STATUSES.unavailable,
          message: 'libmpv is missing',
        },
      },
    ],
  ])('accepts %j', (value) => {
    expect(isPlayerPortMessage(value)).toBe(true)
  })

  it.each([
    [
      'an unknown status',
      { type: WINDOW_MESSAGE_TYPES.playerPort, connection: { status: 'broken' } },
    ],
    [
      'unavailable without a message',
      {
        type: WINDOW_MESSAGE_TYPES.playerPort,
        connection: { status: PLAYER_CONNECTION_STATUSES.unavailable },
      },
    ],
    [
      'the channel name as the type',
      { type: IPC_CHANNELS.player, connection: { status: PLAYER_CONNECTION_STATUSES.native } },
    ],
    ['no connection', { type: WINDOW_MESSAGE_TYPES.playerPort }],
  ])('rejects %s', (_name, value) => {
    expect(isPlayerPortMessage(value)).toBe(false)
  })

  it('narrows a connection on its own', () => {
    expect(isPlayerConnection({ status: PLAYER_CONNECTION_STATUSES.native })).toBe(true)
    expect(
      isPlayerConnection({ status: PLAYER_CONNECTION_STATUSES.unavailable, message: 'x' }),
    ).toBe(true)
    expect(isPlayerConnection({ status: PLAYER_CONNECTION_STATUSES.unavailable })).toBe(false)
  })
})

describe('the download guards', () => {
  it('accepts a short lowercase container and refuses a path', () => {
    expect(isContainerName('mkv')).toBe(true)
    expect(isContainerName('../x')).toBe(false)
    expect(isContainerName('')).toBe(false)
    expect(isContainerName('matroska01')).toBe(false)
  })

  it('accepts external-<n> and refuses any other track id', () => {
    expect(isSidecarTrackId('external-2')).toBe(true)
    expect(isSidecarTrackId('embedded-0')).toBe(false)
    expect(isSidecarTrackId('external-')).toBe(false)
  })

  it('accepts every kind and refuses an unknown one', () => {
    ;['movie', 'episode', 'season', 'show', 'saga'].forEach((kind) => {
      expect(isDownloadKind(kind)).toBe(true)
    })
    expect(isDownloadKind('album')).toBe(false)
  })

  it('accepts a group and refuses one of an unknown kind or with no key', () => {
    const group = { kind: 'season', key: 'show:4', title: 'Severance', order: 20004 }
    expect(isDownloadGroup(group)).toBe(true)
    expect(isDownloadGroup({ ...group, kind: 'album' })).toBe(false)
    expect(isDownloadGroup({ kind: 'season', title: 'Severance', order: 20004 })).toBe(false)
    expect(isDownloadGroup({ ...group, key: 4 })).toBe(false)
    expect(isDownloadGroup({ kind: 'season', key: 'show:4', title: 'Severance' })).toBe(false)
  })

  it('accepts each status and refuses an unknown kind', () => {
    ;[
      { kind: 'queued' },
      { kind: 'downloading', bytes: 5 },
      { kind: 'paused', bytes: 5, message: null },
      { kind: 'failed', bytes: 5, message: 'disk full' },
      { kind: 'ready' },
    ].forEach((status) => {
      expect(isDownloadStatus(status)).toBe(true)
    })
    expect(isDownloadStatus({ kind: 'stalled', bytes: 5 })).toBe(false)
    expect(isDownloadStatus({ kind: 'failed', bytes: 5 })).toBe(false)
  })
})

describe('the download ask and views', () => {
  it('accepts each status of an ask', () => {
    expect(isDownloadAskStatus(READY)).toBe(true)
    expect(isDownloadAskStatus({ kind: 'locked' })).toBe(true)
    expect(isDownloadAskStatus({ kind: 'hidden' })).toBe(true)
    expect(isDownloadAskStatus({ ...READY, downloadKind: 'album' })).toBe(false)
    expect(isDownloadAskStatus({ ...READY, files: '3' })).toBe(false)
  })

  it('accepts an ask by ids and refuses one whose ids are a path or an origin', () => {
    expect(isDownloadAsk(ASK)).toBe(true)
    expect(isDownloadAsk({ ...ASK, askId: '../downloads.json' })).toBe(false)
    expect(isDownloadAsk({ ...ASK, serverId: 'https://raven.example' })).toBe(false)
  })

  it('accepts a view with or without its watched share and deletion time', () => {
    expect(isDownloadView(VIEW)).toBe(true)
    expect(isDownloadView({ ...VIEW, watched: 0.4, deletesAt: 1_700_000_600_000 })).toBe(true)
    expect(isDownloadView({ ...VIEW, needsUnlock: 'no' })).toBe(false)
    expect(isDownloadView({ ...VIEW, status: { kind: 'stalled' } })).toBe(false)
  })

  it('names its server by an opaque id, never an origin', () => {
    expect(isDownloadView({ ...VIEW, serverId: 'https://raven.example' })).toBe(false)
    expect(isDownloadView({ ...VIEW, serverId: undefined })).toBe(false)
  })

  it('accepts the space line and refuses one with a string', () => {
    expect(isSpaceView({ free: 1, total: 2, used: 0 })).toBe(true)
    expect(isSpaceView({ free: '1', total: 2, used: 0 })).toBe(false)
  })
})

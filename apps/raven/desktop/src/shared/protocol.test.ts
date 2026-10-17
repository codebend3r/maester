import { describe, expect, it } from 'bun:test'
import {
  APP_HOST,
  APP_ORIGIN,
  APP_SCHEME,
  EVENT_CHANNEL,
  FILE_SCHEME,
  MAX_QUEUE,
  REQUEST_CHANNEL,
  fileUrlFor,
  isDesktopEvent,
  isDesktopReply,
  isDesktopRequest,
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
  isTrackChoice,
  PLAYER_PORT_CHANNEL,
  PLAYER_PORT_MESSAGE,
} from '@/shared/protocol'

const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
const other = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

describe('constants', () => {
  it('names the app origin, the file scheme and the two channels', () => {
    expect(APP_ORIGIN).toBe('app://raven')
    expect(`${APP_SCHEME}://${APP_HOST}`).toBe(APP_ORIGIN)
    expect(FILE_SCHEME).toBe('raven-file')
    expect(REQUEST_CHANNEL).toBe('raven:request')
    expect(EVENT_CHANNEL).toBe('raven:event')
    expect(MAX_QUEUE).toBe(100)
    expect(PLAYER_PORT_CHANNEL).toBe('raven:player')
    expect(PLAYER_PORT_MESSAGE).toBe('raven:player-port')
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
    expect(
      ['togglePlay', 'skipBack', 'skipForward', 'next', 'showShortcuts', 'stats'].every(
        isMenuPlayerAction,
      ),
    ).toBe(true)
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
    [{ type: 'ready' }],
    [{ type: 'openDialog' }],
    [{ type: 'describeFile', fileId: id, queue: [other] }],
    [{ type: 'savePosition', fileId: id, position: 12.5, duration: 600 }],
    [{ type: 'savePosition', fileId: id, position: 12.5, duration: null }],
    [{ type: 'listRecents' }],
    [{ type: 'openRecent', recentId: id }],
    [{ type: 'removeRecent', recentId: id }],
    [{ type: 'clearRecents' }],
    [{ type: 'saveTracks', fileId: id, audio: 1, subtitle: 'embedded-0' }],
    [{ type: 'saveTracks', fileId: id, audio: null, subtitle: null }],
    [{ type: 'saveTracks', fileId: id, audio: 0, subtitle: null }],
    [{ type: 'windowButtons', isVisible: false }],
    [{ type: 'readOutput' }],
    [
      {
        type: 'writeOutput',
        output: { profile: 'pcm', device: 'auto', passthrough: ['ac3'], spatial: false },
      },
    ],
    [{ type: 'serverCall', serverId: id, method: 'GET', path: '/api/media/7', body: null }],
    [
      {
        type: 'serverCall',
        serverId: id,
        method: 'PUT',
        path: '/api/media/7/progress',
        body: '{}',
      },
    ],
    [{ type: 'listServers' }],
    [{ type: 'addServer', origin: 'https://raven.example' }],
    [{ type: 'renameServer', serverId: id, name: 'Home' }],
    [{ type: 'removeServer', serverId: id }],
    [{ type: 'openLink', link: 'raven://play?server=https://raven.example&media=7' }],
    [{ type: 'openInBrowser', serverId: id, mediaId: 7 }],
    [{ type: 'noteServerTitle', serverId: id, mediaId: 7, label: 'Dune', watched: 0.5 }],
    [{ type: 'noteServerTitle', serverId: id, mediaId: 7, label: 'Dune', watched: null }],
  ])('accepts %j', (value) => {
    expect(isDesktopRequest(value)).toBe(true)
  })

  it.each([
    ['a path as the file id', { type: 'describeFile', fileId: '/Users/me/film.mkv', queue: [] }],
    ['a string position', { type: 'savePosition', fileId: id, position: '12', duration: null }],
    ['a missing duration', { type: 'savePosition', fileId: id, position: 12 }],
    ['a string audio index', { type: 'saveTracks', fileId: id, audio: '1', subtitle: null }],
    ['a fractional audio index', { type: 'saveTracks', fileId: id, audio: 1.5, subtitle: null }],
    ['a negative audio index', { type: 'saveTracks', fileId: id, audio: -1, subtitle: null }],
    ['a path in saveTracks', { type: 'saveTracks', fileId: '/m/a.mkv', audio: 1, subtitle: null }],
    ['a string for the window buttons', { type: 'windowButtons', isVisible: 'yes' }],
    ['partial output settings', { type: 'writeOutput', output: { profile: 'pcm' } }],
    [
      'a server call with a method off the list',
      { type: 'serverCall', serverId: id, method: 'DELETE', path: '/api/media/7', body: null },
    ],
    [
      'a server call naming a host for the server',
      { type: 'serverCall', serverId: 'vhagar', method: 'GET', path: '/api/media/7', body: null },
    ],
    [
      'a server call with a number for its body',
      { type: 'serverCall', serverId: id, method: 'POST', path: '/api/media/7/plays', body: 3 },
    ],
    ['a browser open with a media id of zero', { type: 'openInBrowser', serverId: id, mediaId: 0 }],
    [
      'a browser open with a string media id',
      { type: 'openInBrowser', serverId: id, mediaId: '7' },
    ],
    [
      'a server title noted without its share watched',
      { type: 'noteServerTitle', serverId: id, mediaId: 7, label: 'Dune' },
    ],
    ['a server added without an origin', { type: 'addServer' }],
    ['a rename to a number', { type: 'renameServer', serverId: id, name: 7 }],
    ['an unknown type', { type: 'readFile', path: '/etc/hosts' }],
    ['no type', {}],
    ['a string', 'ready'],
  ])('rejects %s', (_name, value) => {
    expect(isDesktopRequest(value)).toBe(false)
  })
})

describe('isDesktopReply', () => {
  it.each([
    [{ type: 'play', target: { fileId: id, queue: [] } }],
    [
      {
        type: 'file',
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
        type: 'output',
        output: { profile: 'passthrough', device: 'auto', passthrough: ['dts'], spatial: false },
        devices: [{ name: 'coreaudio/abc', description: 'Receiver' }],
        isEngineReady: true,
      },
    ],
    [{ type: 'recents', recents: [{ recentId: id, label: 'a', from: 'b', watched: 0.25 }] }],
    [{ type: 'recents', recents: [] }],
    [{ type: 'done' }],
    [{ type: 'refused', message: 'no such file' }],
    [{ type: 'playServer', target: { serverId: id, mediaId: 7, at: 30, next: [8, 9] } }],
    [{ type: 'serverReply', status: 200, body: '{"state":"off"}' }],
    [{ type: 'serverUnreachable', message: 'raven player could not reach raven.example.' }],
    [
      {
        type: 'servers',
        servers: [{ serverId: id, origin: 'https://raven.example', name: 'Home' }],
      },
    ],
    [{ type: 'servers', servers: [] }],
  ])('accepts %j', (value) => {
    expect(isDesktopReply(value)).toBe(true)
  })

  it('rejects a server reply without a status and a server list holding a bare origin', () => {
    expect(isDesktopReply({ type: 'serverReply', body: '' })).toBe(false)
    expect(isDesktopReply({ type: 'serverUnreachable' })).toBe(false)
    expect(isDesktopReply({ type: 'servers', servers: ['https://raven.example'] })).toBe(false)
  })

  it('rejects a refusal without a message and an unknown type', () => {
    expect(isDesktopReply({ type: 'refused' })).toBe(false)
    expect(
      isDesktopReply({
        type: 'output',
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
    expect(isDesktopReply({ type: 'playServer', target: value })).toBe(false)
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
    [{ type: 'play', target: { fileId: id, queue: [] } }],
    [{ type: 'player', action: 'togglePlay' }],
    [{ type: 'player', action: 'stats' }],
    [{ type: 'navigate', to: 'settings' }],
    [{ type: 'notice', message: 'raven links open in a later release' }],
    [{ type: 'playServer', target: { serverId: id, mediaId: 7, at: 30, next: [8] } }],
    [{ type: 'openLink' }],
  ])('accepts %j', (value) => {
    expect(isDesktopEvent(value)).toBe(true)
  })

  it.each([
    ['navigating to devtools', { type: 'navigate', to: 'devtools' }],
    ['navigating home, which nothing in main sends', { type: 'navigate', to: 'home' }],
    ['recentsChanged, which nothing in main sends', { type: 'recentsChanged' }],
    ['a notice without a message', { type: 'notice' }],
    ['openRecent, which only the page asks for', { type: 'openRecent' }],
    [
      'a server title queueing a fractional id',
      { type: 'playServer', target: { serverId: id, mediaId: 7, at: 0, next: [1.5] } },
    ],
  ])('rejects %s', (_name, value) => {
    expect(isDesktopEvent(value)).toBe(false)
  })
})

describe('isInvokeEnvelope', () => {
  it.each([
    [{ kind: 'page', request: { type: 'ready' } }],
    [{ kind: 'page', request: { type: 'openRecent', recentId: id } }],
    [{ kind: 'drop', paths: ['/Users/me/film.mkv', '/Users/me/next.mkv'] }],
    [{ kind: 'drop', paths: [] }],
  ])('accepts %j', (value) => {
    expect(isInvokeEnvelope(value)).toBe(true)
  })

  it.each([
    [
      'a page request off the list',
      { kind: 'page', request: { type: 'readFile', path: '/etc/hosts' } },
    ],
    ['a drop of numbers', { kind: 'drop', paths: [1] }],
    ['an unknown kind', { kind: 'shell', command: 'ls' }],
    ['a bare request', { type: 'ready' }],
  ])('rejects %s', (_name, value) => {
    expect(isInvokeEnvelope(value)).toBe(false)
  })
})

describe('isPlayerPortMessage', () => {
  it.each([
    [{ type: 'raven:player-port', connection: { status: 'native' } }],
    [
      {
        type: 'raven:player-port',
        connection: { status: 'unavailable', message: 'libmpv is missing' },
      },
    ],
  ])('accepts %j', (value) => {
    expect(isPlayerPortMessage(value)).toBe(true)
  })

  it.each([
    ['an unknown status', { type: 'raven:player-port', connection: { status: 'broken' } }],
    [
      'unavailable without a message',
      { type: 'raven:player-port', connection: { status: 'unavailable' } },
    ],
    ['the channel name as the type', { type: 'raven:player', connection: { status: 'native' } }],
    ['no connection', { type: 'raven:player-port' }],
  ])('rejects %s', (_name, value) => {
    expect(isPlayerPortMessage(value)).toBe(false)
  })

  it('narrows a connection on its own', () => {
    expect(isPlayerConnection({ status: 'native' })).toBe(true)
    expect(isPlayerConnection({ status: 'unavailable', message: 'x' })).toBe(true)
    expect(isPlayerConnection({ status: 'unavailable' })).toBe(false)
  })
})

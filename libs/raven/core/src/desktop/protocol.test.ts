import { describe, expect, it } from 'bun:test'
import {
  WINDOW_ACTIONS,
  WINDOW_EDGES,
  DESKTOP_EVENTS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_KINDS,
  ENVELOPE_KINDS,
  FILE_SCHEME,
  MAX_ACCESS_TOKEN,
  MAX_SECRET,
  MENU_PLAYER_ACTIONS,
  PLAYER_CONNECTION_STATUSES,
  TITLE_REFUSALS,
  WATCH_PARAMS,
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
  isPagePath,
  isPageSession,
  isPlayerConnection,
  isPlayerPortMessage,
  isPlayTarget,
  isRecentView,
  isSidecarTrackId,
  isSpaceView,
  isTitleRefusal,
  isTrackChoice,
  isUpdateStatus,
  readWatchQuery,
  watchPathFor,
} from '@/desktop/protocol'
import { PAGE_PATHS } from '@/itemLinks'
import { DOWNLOAD_TARGET_KINDS, PLAY_LINK_MAX_NEXT } from '@/playLink'
import { PLAYER_SOURCE_KINDS } from '@/player'

const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
const other = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

const READY = {
  kind: 'ready',
  title: 'The Lord of the Rings Collection',
  downloadKind: 'saga',
  files: 3,
  bytes: 44_236_810_240,
  free: 442_381_631_488,
  canFit: true,
} as const

const ASK = {
  askId: id,
  serverId: other,
  serverName: 'Vhagar',
  shouldAutoDelete: false,
  status: READY,
}

const VIEW = {
  downloadId: id,
  serverId: other,
  label: 'The Two Towers (2002)',
  group: {
    kind: DOWNLOAD_KINDS.saga,
    key: 'saga:1:119',
    title: 'The Lord of the Rings Collection',
    order: 1,
  },
  serverName: 'Vhagar',
  size: 15_891_378_995,
  status: { kind: 'downloading', bytes: 12_992_272_384 },
  shouldAutoDelete: true,
  watched: null,
  deletesAt: null,
  isLocked: false,
} as const

const SESSION = { accessToken: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2ln', userId: id }

const UPDATES = {
  isEnabled: true,
  current: '0.5.4',
  checkedAt: null,
  latest: null,
  problem: 'GitHub did not answer.',
} as const

describe('constants', () => {
  it('names the file scheme and the player port message type', () => {
    expect(FILE_SCHEME).toBe('raven-file')
    expect(WINDOW_MESSAGE_TYPES.playerPort).toBe('raven:player-port')
  })
})

describe('isOpaqueId', () => {
  it('accepts a lowercase version 4 UUID, which is what crypto.randomUUID returns', () => {
    expect(isOpaqueId(id)).toBe(true)
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
        isDownload: false,
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
        isDownload: false,
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

  it('rejects a local file that does not say whether it is a download', () => {
    expect(
      isLocalFile({
        fileId: id,
        label: 'film.mkv',
        folder: 'Movies',
        resumeAt: 0,
        next: null,
        tracks: null,
      }),
    ).toBe(false)
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
    [{ type: DESKTOP_REQUESTS.windowControl, action: WINDOW_ACTIONS.minimize }],
    [{ type: DESKTOP_REQUESTS.windowControl, action: WINDOW_ACTIONS.maximize }],
    [{ type: DESKTOP_REQUESTS.windowControl, action: WINDOW_ACTIONS.close }],
    [{ type: DESKTOP_REQUESTS.startWindowResize, edge: WINDOW_EDGES.bottomRight, x: 900, y: 700 }],
    [{ type: DESKTOP_REQUESTS.moveWindowResize, x: 920.5, y: 712 }],
    [{ type: DESKTOP_REQUESTS.readOutput }],
    [
      {
        type: DESKTOP_REQUESTS.writeOutput,
        output: { profile: 'pcm', device: 'auto', passthrough: ['ac3'], spatial: false },
      },
    ],
    [
      {
        type: DESKTOP_REQUESTS.openLink,
        link: 'raven://play?server=https://raven.example&media=7',
      },
    ],
    [{ type: DESKTOP_REQUESTS.readUpdates }],
    [{ type: DESKTOP_REQUESTS.setUpdateCheck, isEnabled: false }],
    [{ type: DESKTOP_REQUESTS.checkForUpdates }],
    [{ type: DESKTOP_REQUESTS.openRelease }],
    [{ type: DESKTOP_REQUESTS.confirmDownload, askId: id, shouldAutoDelete: true }],
    [{ type: DESKTOP_REQUESTS.declineDownload, askId: id }],
    [{ type: DESKTOP_REQUESTS.retryDownloadAsk, askId: id }],
    [{ type: DESKTOP_REQUESTS.listDownloads }],
    [{ type: DESKTOP_REQUESTS.openDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.pauseDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.resumeDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.retryDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.deleteDownload, downloadId: id }],
    [{ type: DESKTOP_REQUESTS.setDownloadAutoDelete, downloadId: id, shouldAutoDelete: false }],
    [{ type: DESKTOP_REQUESTS.pauseAllDownloads }],
    [{ type: DESKTOP_REQUESTS.resumeAllDownloads }],
    [{ type: DESKTOP_REQUESTS.deleteAllDownloads }],
    [{ type: DESKTOP_REQUESTS.readSpace }],
    [{ type: DESKTOP_REQUESTS.setDownloadDefaults, shouldAutoDelete: true }],
    [{ type: DESKTOP_REQUESTS.showDownloadsFolder }],
    [{ type: DESKTOP_REQUESTS.playbackLeft, fileId: id }],
    [{ type: DESKTOP_REQUESTS.accountToken, session: SESSION }],
    [{ type: DESKTOP_REQUESTS.accountToken, session: null }],
    [
      {
        type: DESKTOP_REQUESTS.askDownload,
        target: { kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 },
      },
    ],
    [
      {
        type: DESKTOP_REQUESTS.askDownload,
        target: { kind: DOWNLOAD_TARGET_KINDS.item, itemId: 4 },
      },
    ],
    [
      {
        type: DESKTOP_REQUESTS.askDownload,
        target: { kind: DOWNLOAD_TARGET_KINDS.saga, libraryId: 1, tmdbId: '119' },
      },
    ],
    [{ type: DESKTOP_REQUESTS.playTitle, mediaId: 7, at: 0, next: [] }],
    [{ type: DESKTOP_REQUESTS.playTitle, mediaId: 7, at: 30.5, next: [8, 9] }],
  ])('accepts %j', (value) => {
    expect(isDesktopRequest(value)).toBe(true)
  })

  it.each([
    [
      'a path as the file id',
      { type: DESKTOP_REQUESTS.describeFile, fileId: '/Users/me/film.mkv', queue: [] },
    ],
    [
      'a path for the file left',
      { type: DESKTOP_REQUESTS.playbackLeft, fileId: '/Users/me/film.mkv' },
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
    ['an unknown window action', { type: DESKTOP_REQUESTS.windowControl, action: 'fullscreen' }],
    [
      'an unknown resize edge',
      { type: DESKTOP_REQUESTS.startWindowResize, edge: 'middle', x: 0, y: 0 },
    ],
    ['a resize with no point', { type: DESKTOP_REQUESTS.moveWindowResize, x: 10 }],
    ['partial output settings', { type: DESKTOP_REQUESTS.writeOutput, output: { profile: 'pcm' } }],
    ['the server call the page no longer makes', { type: 'serverCall', serverId: id }],
    [
      'the sign in main no longer makes',
      { type: 'signIn', serverId: id, email: 'a', password: 'b' },
    ],
    ['a token with no session', { type: DESKTOP_REQUESTS.accountToken }],
    [
      'a session with no account',
      { type: DESKTOP_REQUESTS.accountToken, session: { accessToken: SESSION.accessToken } },
    ],
    [
      'a session with an empty token',
      { type: DESKTOP_REQUESTS.accountToken, session: { ...SESSION, accessToken: '' } },
    ],
    [
      'a session whose token is past its cap',
      {
        type: DESKTOP_REQUESTS.accountToken,
        session: { ...SESSION, accessToken: 't'.repeat(MAX_ACCESS_TOKEN + 1) },
      },
    ],
    [
      'a session whose account id is past its cap',
      {
        type: DESKTOP_REQUESTS.accountToken,
        session: { ...SESSION, userId: 'u'.repeat(MAX_SECRET + 1) },
      },
    ],
    [
      'a download of a media id of zero',
      {
        type: DESKTOP_REQUESTS.askDownload,
        target: { kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 0 },
      },
    ],
    ['a download with no target', { type: DESKTOP_REQUESTS.askDownload }],
    ['a title of id zero', { type: DESKTOP_REQUESTS.playTitle, mediaId: 0, at: 0, next: [] }],
    ['a title from before 0', { type: DESKTOP_REQUESTS.playTitle, mediaId: 7, at: -1, next: [] }],
    [
      'a title whose start is a string',
      { type: DESKTOP_REQUESTS.playTitle, mediaId: 7, at: '30', next: [] },
    ],
    [
      'a title whose next holds a fraction',
      { type: DESKTOP_REQUESTS.playTitle, mediaId: 7, at: 0, next: [1.5] },
    ],
    [
      'a title with more after it than a link carries',
      {
        type: DESKTOP_REQUESTS.playTitle,
        mediaId: 7,
        at: 0,
        next: Array.from({ length: PLAY_LINK_MAX_NEXT + 1 }, (_, index) => index + 1),
      },
    ],
    ['a title with no next', { type: DESKTOP_REQUESTS.playTitle, mediaId: 7, at: 0 }],
    ['the PIN main takes no more', { type: 'unlock', pin: '3001' }],
    [
      'an update switch set by a string',
      { type: DESKTOP_REQUESTS.setUpdateCheck, isEnabled: 'true' },
    ],
    ['an update switch with no value', { type: DESKTOP_REQUESTS.setUpdateCheck }],
    ['a confirmation without its choice', { type: DESKTOP_REQUESTS.confirmDownload, askId: id }],
    [
      'a confirmation naming its ask by a path',
      {
        type: DESKTOP_REQUESTS.confirmDownload,
        askId: '/Users/me/film.mkv',
        shouldAutoDelete: false,
      },
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
      { type: DESKTOP_REQUESTS.setDownloadAutoDelete, downloadId: id, shouldAutoDelete: 'yes' },
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
          isDownload: false,
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
    [{ type: DESKTOP_REPLIES.navigate, to: '/watch/7?at=30&next=8%2C9' }],
    [
      {
        type: DESKTOP_REPLIES.title,
        source: { kind: PLAYER_SOURCE_KINDS.server, serverId: id, mediaId: 7 },
        resumeAt: 30,
        next: [8, 9],
      },
    ],
    [
      {
        type: DESKTOP_REPLIES.title,
        source: { kind: PLAYER_SOURCE_KINDS.file, fileId: id },
        resumeAt: 0,
        next: [],
      },
    ],
    [
      {
        type: DESKTOP_REPLIES.titleRefused,
        reason: TITLE_REFUSALS.locked,
        message: 'raven locked this library again.',
      },
    ],
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
        ask: { ...ASK, shouldAutoDelete: true, status: { kind: 'account' } },
      },
    ],
    [{ type: DESKTOP_REPLIES.downloads, downloads: [VIEW], shouldAutoDeleteByDefault: false }],
    [{ type: DESKTOP_REPLIES.downloads, downloads: [], shouldAutoDeleteByDefault: true }],
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
      {
        type: DESKTOP_REPLIES.downloadAsk,
        ask: { ...ASK, status: { ...READY, canFit: undefined } },
      },
    ],
    [
      'an ask of an unknown status',
      { type: DESKTOP_REPLIES.downloadAsk, ask: { ...ASK, status: { kind: 'unlocked' } } },
    ],
    [
      'an ask without its default',
      { type: DESKTOP_REPLIES.downloadAsk, ask: { ...ASK, shouldAutoDelete: undefined } },
    ],
    [
      'a download named by its path',
      {
        type: DESKTOP_REPLIES.downloads,
        downloads: [{ ...VIEW, downloadId: '/Users/me/Library/raven/downloads/a/7/video.mkv' }],
        shouldAutoDeleteByDefault: false,
      },
    ],
    ['a list without its default', { type: DESKTOP_REPLIES.downloads, downloads: [] }],
    [
      'a space without what downloads use',
      { type: DESKTOP_REPLIES.space, space: { free: 1, total: 2 } },
    ],
    [
      'an ask that hides its title behind the admin lock, which servers with accounts never do',
      { type: DESKTOP_REPLIES.downloadAsk, ask: { ...ASK, status: { kind: 'hidden' } } },
    ],
    ['a path to another origin', { type: DESKTOP_REPLIES.navigate, to: '//evil.example/watch/7' }],
    [
      'a title from a source the player does not know',
      {
        type: DESKTOP_REPLIES.title,
        source: { kind: 'url', url: 'https://evil.example/a.mkv' },
        resumeAt: 0,
        next: [],
      },
    ],
    [
      'a title with no start',
      {
        type: DESKTOP_REPLIES.title,
        source: { kind: PLAYER_SOURCE_KINDS.file, fileId: id },
        next: [],
      },
    ],
    [
      'a refusal for a reason the page cannot act on',
      { type: DESKTOP_REPLIES.titleRefused, reason: 'busy', message: 'x' },
    ],
    [
      'a refusal without its message',
      { type: DESKTOP_REPLIES.titleRefused, reason: TITLE_REFUSALS.gone },
    ],
    ['the server list main no longer keeps', { type: 'servers', servers: [] }],
    ['the account view main no longer reads', { type: 'account', account: {} }],
  ])('rejects %s', (_name, value) => {
    expect(isDesktopReply(value)).toBe(false)
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

describe('isPagePath', () => {
  it.each([['/'], ['/settings'], ['/watch/7'], ['/watch/7?at=30&next=8%2C9']])(
    'accepts %s',
    (path) => {
      expect(isPagePath(path)).toBe(true)
    },
  )

  it.each([
    ['a relative path', 'settings'],
    ['a path to another origin', '//evil.example/'],
    ['a backslash that browsers read as a slash', '/\\evil.example'],
    ['an address', 'https://evil.example/'],
    ['a script', 'javascript:alert(1)'],
    ['a newline', '/watch/7\n'],
    ['a space', '/watch /7'],
    ['an empty string', ''],
    ['a path past its cap', `/${'a'.repeat(2048)}`],
    ['a number', 7],
  ])('rejects %s', (_name, value) => {
    expect(isPagePath(value)).toBe(false)
  })
})

describe('watchPathFor', () => {
  it("names the web's watch page with nothing more when the title starts at 0 and nothing follows", () => {
    expect(watchPathFor({ mediaId: 7, at: 0, next: [] })).toBe('/watch/7')
  })

  it('carries where to start, in whole seconds, and the titles after it', () => {
    const path = watchPathFor({ mediaId: 7, at: 30.9, next: [8, 9] })
    expect(path).toBe('/watch/7?at=30&next=8%2C9')
    expect(isPagePath(path)).toBe(true)
  })

  it('leaves out a start before 0 and next ids that are not ones', () => {
    expect(watchPathFor({ mediaId: 7, at: -5, next: [0, 1.5] })).toBe('/watch/7')
  })

  it('throws for a media id that is not one', () => {
    expect(() => watchPathFor({ mediaId: 0, at: 0, next: [] })).toThrow('not a media id')
  })

  it('reads back what it wrote', () => {
    const [, query = ''] = watchPathFor({ mediaId: 7, at: 30, next: [8, 9] }).split('?')
    expect(readWatchQuery(query)).toEqual({ at: 30, next: [8, 9] })
    expect(readWatchQuery(`?${query}`)).toEqual({ at: 30, next: [8, 9] })
  })
})

describe('readWatchQuery', () => {
  it('starts at 0 with nothing after for an empty query', () => {
    expect(readWatchQuery('')).toEqual({ at: 0, next: [] })
  })

  it.each([
    ['a start that is not a whole number', `${WATCH_PARAMS.at}=1.5`, { at: 0, next: [] }],
    ['a start that is negative', `${WATCH_PARAMS.at}=-5`, { at: 0, next: [] }],
    ['a queue holding a zero', `${WATCH_PARAMS.next}=8%2C0`, { at: 0, next: [] }],
    ['a queue holding a padded id', `${WATCH_PARAMS.next}=08`, { at: 0, next: [] }],
    [
      'a queue holding a word',
      `${WATCH_PARAMS.at}=4&${WATCH_PARAMS.next}=8%2Cx`,
      { at: 4, next: [] },
    ],
  ])('reads the default for %s', (_name, query, expected) => {
    expect(readWatchQuery(query)).toEqual(expected)
  })

  it('reads no queue longer than a link carries', () => {
    const ids = Array.from({ length: PLAY_LINK_MAX_NEXT + 1 }, (_, index) => index + 1)
    expect(readWatchQuery(`${WATCH_PARAMS.next}=${ids.join('%2C')}`).next).toEqual([])
  })
})

describe('isPageSession and isTitleRefusal', () => {
  it("accepts the page's token and account, and nothing without both", () => {
    expect(isPageSession(SESSION)).toBe(true)
    expect(isPageSession({ ...SESSION, userId: '' })).toBe(false)
    expect(isPageSession({ userId: id })).toBe(false)
  })

  it('names the five reasons a title is refused', () => {
    expect(isTitleRefusal.values).toEqual(['signedOut', 'denied', 'locked', 'gone', 'unreachable'])
  })
})

describe('isDesktopEvent', () => {
  it.each([
    [{ type: DESKTOP_EVENTS.play, target: { fileId: id, queue: [] } }],
    [{ type: DESKTOP_EVENTS.player, action: MENU_PLAYER_ACTIONS.togglePlay }],
    [{ type: DESKTOP_EVENTS.player, action: MENU_PLAYER_ACTIONS.stats }],
    [{ type: DESKTOP_EVENTS.navigate, to: PAGE_PATHS.settings }],
    [{ type: DESKTOP_EVENTS.navigate, to: watchPathFor({ mediaId: 7, at: 30, next: [8] }) }],
    [{ type: DESKTOP_EVENTS.notice, message: 'raven links open in a later release' }],
    [{ type: DESKTOP_EVENTS.openLink }],
    [{ type: DESKTOP_EVENTS.updateAvailable, version: '0.6.0' }],
    [{ type: DESKTOP_EVENTS.downloadAsk, ask: ASK }],
    [{ type: DESKTOP_EVENTS.downloads, downloads: [VIEW], shouldAutoDeleteByDefault: false }],
  ])('accepts %j', (value) => {
    expect(isDesktopEvent(value)).toBe(true)
  })

  it.each([
    ['navigating to a name rather than a path', { type: DESKTOP_EVENTS.navigate, to: 'settings' }],
    [
      'navigating to another origin',
      { type: DESKTOP_EVENTS.navigate, to: 'https://evil.example/' },
    ],
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
    ['a switch of account, which the page makes itself', { type: 'accountSwitched' }],
    [
      'a list of downloads without its default',
      { type: DESKTOP_EVENTS.downloads, downloads: [VIEW] },
    ],
    [
      'a server title, which now opens as a path',
      { type: 'playServer', target: { serverId: id, mediaId: 7, at: 0, next: [] } },
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
      { type: 'raven:player', connection: { status: PLAYER_CONNECTION_STATUSES.native } },
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
    expect(isDownloadAskStatus({ kind: DOWNLOAD_ASK_KINDS.account })).toBe(true)
    expect(isDownloadAskStatus({ kind: 'hidden' })).toBe(false)
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
    expect(isDownloadView({ ...VIEW, isLocked: 'no' })).toBe(false)
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

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
  isPlayTarget,
  isRecentView,
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
      }),
    ).toBe(true)
    expect(
      isLocalFile({ fileId: id, label: 'film.mkv', folder: 'Movies', resumeAt: 0, next: null }),
    ).toBe(true)
    expect(isRecentView({ recentId: id, label: 'film.mkv', from: 'Movies', watched: null })).toBe(
      true,
    )
    expect(isRecentView({ recentId: id, label: 'film.mkv', from: 'Movies', watched: 0.5 })).toBe(
      true,
    )
    expect(
      ['togglePlay', 'skipBack', 'skipForward', 'next', 'showShortcuts'].every(isMenuPlayerAction),
    ).toBe(true)
  })

  it('rejects ids that are not opaque and unknown actions', () => {
    expect(isPlayTarget({ fileId: '/Users/me/film.mkv', queue: [] })).toBe(false)
    expect(isPlayTarget({ fileId: id, queue: ['/Users/me/next.mkv'] })).toBe(false)
    expect(isRecentView({ recentId: 'abc', label: 'a', from: 'b', watched: null })).toBe(false)
    expect(isMenuPlayerAction('stats')).toBe(false)
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
  ])('accepts %j', (value) => {
    expect(isDesktopRequest(value)).toBe(true)
  })

  it.each([
    ['a path as the file id', { type: 'describeFile', fileId: '/Users/me/film.mkv', queue: [] }],
    ['a string position', { type: 'savePosition', fileId: id, position: '12', duration: null }],
    ['a missing duration', { type: 'savePosition', fileId: id, position: 12 }],
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
        file: { fileId: id, label: 'a.mkv', folder: 'Movies', resumeAt: 0, next: null },
      },
    ],
    [{ type: 'recents', recents: [{ recentId: id, label: 'a', from: 'b', watched: 0.25 }] }],
    [{ type: 'recents', recents: [] }],
    [{ type: 'done' }],
    [{ type: 'refused', message: 'no such file' }],
  ])('accepts %j', (value) => {
    expect(isDesktopReply(value)).toBe(true)
  })

  it('rejects a refusal without a message and an unknown type', () => {
    expect(isDesktopReply({ type: 'refused' })).toBe(false)
    expect(isDesktopReply({ type: 'exec' })).toBe(false)
  })
})

describe('isDesktopEvent', () => {
  it.each([
    [{ type: 'play', target: { fileId: id, queue: [] } }],
    [{ type: 'player', action: 'togglePlay' }],
    [{ type: 'navigate', to: 'home' }],
    [{ type: 'navigate', to: 'settings' }],
    [{ type: 'notice', message: 'raven links open in a later release' }],
    [{ type: 'recentsChanged' }],
  ])('accepts %j', (value) => {
    expect(isDesktopEvent(value)).toBe(true)
  })

  it.each([
    ['navigating to devtools', { type: 'navigate', to: 'devtools' }],
    ['the stats action, which waits for P5', { type: 'player', action: 'stats' }],
    ['a notice without a message', { type: 'notice' }],
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

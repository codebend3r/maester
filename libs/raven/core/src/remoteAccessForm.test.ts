import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  REACHABILITY_PROBLEMS,
  REMOTE_ACCESS_STATES,
  REMOTE_LIMITS,
  type RemoteAccessSettings,
  type RemoteAccessState,
  type RemoteAccessStatus,
} from '@/contract'
import { formatBitrate } from '@/format'
import {
  REMOTE_ACCESS_TEXT_FIELDS,
  addressLineOf,
  checkedTimeOf,
  draftNumberOf,
  remoteAccessChangeOf,
  remoteAccessDraftOf,
  remoteAccessHopsOf,
  remoteLimitLabelOf,
} from '@/remoteAccessForm'

const SETTINGS: RemoteAccessSettings = {
  isEnabled: true,
  hostname: 'raven.example.com',
  publicPort: 8443,
  privatePort: null,
  uploadMbps: 50,
  remoteLimit: 'medium720',
}

const CHECKED_AT = '2026-11-04T00:00:00.000Z'

const REACHABLE: RemoteAccessStatus = {
  state: REMOTE_ACCESS_STATES.reachable,
  isClientAddressForwarded: true,
  publicAddress: '203.0.113.9',
  resolved: ['203.0.113.9'],
  checkedAt: CHECKED_AT,
}

describe('the Remote Access draft', () => {
  it('lists the text fields in the order a form shows them', () => {
    expect(REMOTE_ACCESS_TEXT_FIELDS).toEqual([
      'hostname',
      'publicPort',
      'privatePort',
      'uploadMbps',
    ])
  })

  it('starts from the settings, each text field as its text and none as blank', () => {
    expect(remoteAccessDraftOf(SETTINGS)).toEqual({
      isEnabled: true,
      hostname: 'raven.example.com',
      publicPort: '8443',
      privatePort: '',
      uploadMbps: '50',
      remoteLimit: 'medium720',
    })
  })

  it('sends every field, a blank one as none and the hostname as a certificate names it', () => {
    expect(
      remoteAccessChangeOf({
        ...remoteAccessDraftOf(DEFAULT_REMOTE_ACCESS_SETTINGS),
        hostname: '  Raven.Example.COM ',
        publicPort: '8443',
        privatePort: ' ',
        uploadMbps: '12.5',
      }),
    ).toEqual({
      isEnabled: DEFAULT_REMOTE_ACCESS_SETTINGS.isEnabled,
      hostname: 'raven.example.com',
      publicPort: 8443,
      privatePort: null,
      uploadMbps: 12.5,
      remoteLimit: DEFAULT_REMOTE_ACCESS_SETTINGS.remoteLimit,
    })
    expect(remoteAccessChangeOf(remoteAccessDraftOf(DEFAULT_REMOTE_ACCESS_SETTINGS)).hostname).toBe(
      null,
    )
  })

  it('reads a blank field as no number', () => {
    expect(draftNumberOf('')).toBeNull()
    expect(draftNumberOf('  ')).toBeNull()
    expect(draftNumberOf('42')).toBe(42)
  })
})

describe('remoteLimitLabelOf', () => {
  it('says Original in the client words, and a size with its bitrate otherwise', () => {
    const copy = { original: 'No limit' }
    expect(remoteLimitLabelOf({ limit: REMOTE_LIMITS.original, copy })).toBe('No limit')
    expect(remoteLimitLabelOf({ limit: 'medium720', copy })).toBe(
      `720p HD (Medium), ${formatBitrate(3_000_000)}`,
    )
  })
})

describe('the way in', () => {
  const state = (overrides: Partial<RemoteAccessState>): RemoteAccessState => ({
    settings: SETTINGS,
    privateAddress: '192.168.1.5',
    publicOrigin: null,
    status: { state: REMOTE_ACCESS_STATES.unchecked },
    ...overrides,
  })

  it('takes the public port for the private hop when no private one is set, and the hostname before a check', () => {
    expect(remoteAccessHopsOf(state({}))).toEqual({
      privateHop: { address: '192.168.1.5', port: 8443 },
      publicHop: { address: 'raven.example.com', port: 8443 },
    })
  })

  it('takes the address a check saw for the public hop, and the private port when set', () => {
    expect(
      remoteAccessHopsOf(
        state({ settings: { ...SETTINGS, privatePort: 8484 }, status: REACHABLE }),
      ),
    ).toEqual({
      privateHop: { address: '192.168.1.5', port: 8484 },
      publicHop: { address: '203.0.113.9', port: 8443 },
    })
  })

  it('writes a hop as address:port, in the client words for what is not known', () => {
    const copy = { unknownAddress: 'Unknown', noPort: 'none' }
    expect(addressLineOf({ address: '10.0.0.2', port: 8484, copy })).toBe('10.0.0.2:8484')
    expect(addressLineOf({ address: null, port: null, copy })).toBe('Unknown:none')
  })
})

describe('checkedTimeOf', () => {
  it('gives when a check looked, in the viewer time', () => {
    expect(checkedTimeOf(REACHABLE)).toBe(new Date(CHECKED_AT).toLocaleTimeString())
    expect(
      checkedTimeOf({
        state: REMOTE_ACCESS_STATES.unreachable,
        problem: REACHABILITY_PROBLEMS.timeout,
        publicAddress: null,
        resolved: [],
        checkedAt: CHECKED_AT,
      }),
    ).toBe(new Date(CHECKED_AT).toLocaleTimeString())
  })

  it('is null before any check', () => {
    expect(checkedTimeOf({ state: REMOTE_ACCESS_STATES.disabled })).toBeNull()
  })
})

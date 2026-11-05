import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  REMOTE_ACCESS_STATES,
  REMOTE_LIMITS,
  isEchoNonce,
  isPort,
  isPublicHostname,
  isRemoteAccessChange,
  isRemoteAccessSettings,
  isRemoteAccessStatus,
  isReachabilityReport,
  isMediaOrigins,
  MEDIA_ORIGIN_KINDS,
  PLAYBACK_MODES,
} from '@/contract'
import {
  isAwayPlay,
  planForNetwork,
  publicOriginOf,
  remoteQualityFor,
  remoteStreamsAt,
  remoteTranscodeFor,
} from '@/remoteAccess'

describe('remote access settings', () => {
  it('starts off, with nothing set and no limit', () => {
    expect(isRemoteAccessSettings(DEFAULT_REMOTE_ACCESS_SETTINGS)).toBe(true)
    expect(DEFAULT_REMOTE_ACCESS_SETTINGS.isEnabled).toBe(false)
    expect(DEFAULT_REMOTE_ACCESS_SETTINGS.remoteLimit).toBe(REMOTE_LIMITS.original)
  })

  it('takes a DNS name for the hostname, never an address or a URL', () => {
    expect(isPublicHostname('raven.example.synology.me')).toBe(true)
    expect(isPublicHostname('xn--rvn-xla.example')).toBe(true)
    expect(isPublicHostname('203.0.113.4')).toBe(false)
    expect(isPublicHostname('localhost')).toBe(false)
    expect(isPublicHostname('Raven.Example.com')).toBe(false)
    expect(isPublicHostname('https://raven.example.com')).toBe(false)
    expect(isPublicHostname('raven.example.com:8443')).toBe(false)
    expect(isPublicHostname('-raven.example.com')).toBe(false)
  })

  it('takes a whole port from 1 to 65535', () => {
    expect(isPort(1)).toBe(true)
    expect(isPort(65_535)).toBe(true)
    expect(isPort(0)).toBe(false)
    expect(isPort(65_536)).toBe(false)
    expect(isPort(84.5)).toBe(false)
    expect(isPort('8443')).toBe(false)
  })

  it('takes a change of any known fields, each valid', () => {
    expect(isRemoteAccessChange({})).toBe(true)
    expect(isRemoteAccessChange({ publicPort: 8443, uploadMbps: 40 })).toBe(true)
    expect(isRemoteAccessChange({ remoteLimit: 'low720' })).toBe(true)
    expect(isRemoteAccessChange({ remoteLimit: 'huge' })).toBe(false)
    expect(isRemoteAccessChange({ uploadMbps: 0 })).toBe(false)
    expect(isRemoteAccessChange({ hostname: '192.168.50.6' })).toBe(false)
    expect(isRemoteAccessChange({ port: 8443 })).toBe(false)
  })

  it('reads a check and a status by their state', () => {
    const seen = { publicAddress: '203.0.113.9', resolved: ['203.0.113.9'] }
    expect(isReachabilityReport({ state: REMOTE_ACCESS_STATES.reachable, ...seen })).toBe(true)
    expect(
      isReachabilityReport({
        state: REMOTE_ACCESS_STATES.unreachable,
        problem: 'timeout',
        ...seen,
      }),
    ).toBe(true)
    expect(isReachabilityReport({ state: REMOTE_ACCESS_STATES.unreachable, ...seen })).toBe(false)
    expect(isRemoteAccessStatus({ state: REMOTE_ACCESS_STATES.disabled })).toBe(true)
    expect(
      isRemoteAccessStatus({
        state: REMOTE_ACCESS_STATES.reachable,
        isClientAddressForwarded: true,
        checkedAt: '2026-11-04T00:00:00.000Z',
        ...seen,
      }),
    ).toBe(true)
    expect(
      isRemoteAccessStatus({ state: REMOTE_ACCESS_STATES.reachable, ...seen, checkedAt: '' }),
    ).toBe(false)
  })

  it('knows a nonce by its form', () => {
    expect(isEchoNonce('AAAAAAAAAAAAAAAAAAAAAA')).toBe(true)
    expect(isEchoNonce('short')).toBe(false)
    expect(isEchoNonce('AAAAAAAAAAAAAAAAAAAAA/')).toBe(false)
  })
})

describe('publicOriginOf', () => {
  const configured = { isEnabled: true, hostname: 'raven.example.com', publicPort: 8443 }

  it('names the port unless it is 443', () => {
    expect(publicOriginOf(configured)).toBe('https://raven.example.com:8443')
    expect(publicOriginOf({ ...configured, publicPort: 443 })).toBe('https://raven.example.com')
  })

  it('is null while off or missing a hostname or a port', () => {
    expect(publicOriginOf({ ...configured, isEnabled: false })).toBeNull()
    expect(publicOriginOf({ ...configured, hostname: null })).toBeNull()
    expect(publicOriginOf({ ...configured, publicPort: null })).toBeNull()
  })
})

describe('remoteQualityFor', () => {
  it('holds nothing back with no limit and no upload speed', () => {
    expect(remoteQualityFor({ remoteLimit: REMOTE_LIMITS.original, uploadMbps: null })).toBeNull()
  })

  it('is the limit when the upload carries it', () => {
    expect(remoteQualityFor({ remoteLimit: 'medium720', uploadMbps: 40 })).toBe('medium720')
    expect(remoteQualityFor({ remoteLimit: 'high1080', uploadMbps: null })).toBe('high1080')
  })

  it('keeps a stream under the whole upload when that is lower, as Plex does', () => {
    expect(remoteQualityFor({ remoteLimit: REMOTE_LIMITS.original, uploadMbps: 10 })).toBe(
      'standard1080',
    )
    expect(remoteQualityFor({ remoteLimit: REMOTE_LIMITS.original, uploadMbps: 9 })).toBe('low1080')
    expect(remoteQualityFor({ remoteLimit: 'high1080', uploadMbps: 5 })).toBe('high720')
  })

  it('falls to the smallest size on an upload too slow for any', () => {
    expect(remoteQualityFor({ remoteLimit: REMOTE_LIMITS.original, uploadMbps: 0.5 })).toBe(
      'mobile328',
    )
  })
})

describe('remoteStreamsAt', () => {
  it('counts the streams at a size the upload carries at once', () => {
    expect(remoteStreamsAt({ quality: 'high720', uploadMbps: 20 })).toBe(5)
    expect(remoteStreamsAt({ quality: 'high1080', uploadMbps: 10 })).toBe(0)
  })
})

describe('isAwayPlay', () => {
  it('is a public origin, or the server itself reached from outside', () => {
    expect(isAwayPlay({ origin: { kind: MEDIA_ORIGIN_KINDS.public }, remote: null })).toBe(true)
    expect(isAwayPlay({ origin: { kind: MEDIA_ORIGIN_KINDS.lan }, remote: null })).toBe(false)
    expect(isAwayPlay({ origin: null, remote: { limit: null, isOutside: true } })).toBe(true)
    expect(isAwayPlay({ origin: null, remote: undefined })).toBe(false)
  })
})

describe('remoteTranscodeFor', () => {
  const big = { bitrate: 25_700_000 }
  const away = { kind: MEDIA_ORIGIN_KINDS.public }
  const home = { kind: MEDIA_ORIGIN_KINDS.lan }
  const remote = { limit: 'medium1080', isOutside: false } as const

  it('holds a file over the limit to it from a public origin', () => {
    expect(remoteTranscodeFor({ media: big, origin: away, remote })).toBe('medium1080')
  })

  it("holds one from the server's own address only when that is reached from outside", () => {
    expect(remoteTranscodeFor({ media: big, origin: null, remote })).toBeNull()
    expect(
      remoteTranscodeFor({ media: big, origin: null, remote: { ...remote, isOutside: true } }),
    ).toBe('medium1080')
  })

  it('leaves the LAN, a file that fits, an unknown bitrate and no limit as they are', () => {
    expect(remoteTranscodeFor({ media: big, origin: home, remote })).toBeNull()
    expect(remoteTranscodeFor({ media: { bitrate: 9_000_000 }, origin: away, remote })).toBeNull()
    expect(remoteTranscodeFor({ media: { bitrate: null }, origin: away, remote })).toBeNull()
    expect(
      remoteTranscodeFor({ media: big, origin: away, remote: { ...remote, limit: null } }),
    ).toBeNull()
    expect(remoteTranscodeFor({ media: big, origin: away, remote: undefined })).toBeNull()
  })
})

describe('planForNetwork', () => {
  const plan = {
    modes: [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
    problems: [],
  }
  const props = {
    media: { bitrate: 25_700_000 },
    origin: { kind: MEDIA_ORIGIN_KINDS.public },
    remote: { limit: 'high720', isOutside: true },
  } as const

  it('starts with the transcode at the limit, the rest behind it', () => {
    expect(planForNetwork({ plan, ...props })).toEqual({
      plan: {
        modes: [PLAYBACK_MODES.transcode, PLAYBACK_MODES.direct, PLAYBACK_MODES.remux],
        problems: [],
      },
      quality: 'high720',
    })
  })

  it('keeps a plan that can not transcode, and one at home', () => {
    const noTranscode = { modes: [PLAYBACK_MODES.direct], problems: [] }
    expect(planForNetwork({ plan: noTranscode, ...props })).toEqual({
      plan: noTranscode,
      quality: null,
    })
    expect(planForNetwork({ plan, ...props, origin: { kind: MEDIA_ORIGIN_KINDS.lan } })).toEqual({
      plan,
      quality: null,
    })
  })
})

describe('the media origins answer', () => {
  it('takes the remote limit, and an older server that sends none', () => {
    expect(isMediaOrigins({ origins: [] })).toBe(true)
    expect(isMediaOrigins({ origins: [], remote: { limit: 'low720', isOutside: true } })).toBe(true)
    expect(isMediaOrigins({ origins: [], remote: { limit: 'huge', isOutside: true } })).toBe(false)
  })
})

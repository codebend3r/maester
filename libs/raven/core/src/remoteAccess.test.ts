import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  REMOTE_ACCESS_STATES,
  REMOTE_LIMITS,
  isCheckSignature,
  isEchoNonce,
  isPort,
  isReachabilityQuery,
  isPublicHostname,
  isRemoteAccessChange,
  isRemoteAccessSettings,
  isRemoteAccessStatus,
  isReachabilityReport,
  isMediaOrigins,
  MEDIA_ORIGIN_KINDS,
  PLAYBACK_MODES,
  REACHABILITY_PROBLEMS,
  readReachabilityQuery,
  reachabilityQueryString,
} from '@/contract'
import {
  AT_HOME,
  PUBLIC_ORIGIN_STATES,
  checkFactsOf,
  isAwayPlay,
  planForNetwork,
  publicOriginOf,
  publicOriginStateOf,
  remoteLimitApplies,
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

  it('knows a signature by its form: 64 lower case hex digits', () => {
    expect(isCheckSignature('a'.repeat(64))).toBe(true)
    expect(isCheckSignature('0123456789abcdef'.repeat(4))).toBe(true)
    expect(isCheckSignature('A'.repeat(64))).toBe(false)
    expect(isCheckSignature('a'.repeat(63))).toBe(false)
    expect(isCheckSignature('g'.repeat(64))).toBe(false)
  })
})

describe('the reachability query', () => {
  const query = {
    host: 'raven.example.com',
    port: 8443,
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    signature: 'ab'.repeat(32),
  }

  it('reads back what raven builds, with its question mark or without', () => {
    const search = reachabilityQueryString(query)
    expect(search).toBe(
      `host=raven.example.com&port=8443&nonce=AAAAAAAAAAAAAAAAAAAAAA&signature=${'ab'.repeat(32)}`,
    )
    expect(readReachabilityQuery(search)).toEqual(query)
    expect(readReachabilityQuery(`?${search}`)).toEqual(query)
    expect(isReachabilityQuery(query)).toBe(true)
  })

  it('reads nothing with a part missing or malformed', () => {
    const search = (overrides: Record<string, string>) =>
      reachabilityQueryString(query).replace(/([a-z]+)=([^&]*)/g, (pair, key: string) =>
        key in overrides ? `${key}=${overrides[key]}` : pair,
      )
    expect(readReachabilityQuery('')).toBeNull()
    expect(readReachabilityQuery(search({ host: '203.0.113.4' }))).toBeNull()
    expect(readReachabilityQuery(search({ port: '0x20FB' }))).toBeNull()
    expect(readReachabilityQuery(search({ port: '' }))).toBeNull()
    expect(readReachabilityQuery(search({ port: '70000' }))).toBeNull()
    expect(readReachabilityQuery(search({ nonce: 'short' }))).toBeNull()
    expect(readReachabilityQuery(search({ signature: 'AB'.repeat(32) }))).toBeNull()
    expect(
      readReachabilityQuery('host=raven.example.com&port=8443&nonce=AAAAAAAAAAAAAAAAAAAAAA'),
    ).toBeNull()
  })
})

describe('publicOriginStateOf', () => {
  const configured = { isEnabled: true, hostname: 'raven.example.com', publicPort: 8443 }

  it('gives the origin with the hostname and the port it is made of', () => {
    expect(publicOriginStateOf(configured)).toEqual({
      state: PUBLIC_ORIGIN_STATES.configured,
      origin: 'https://raven.example.com:8443',
      hostname: 'raven.example.com',
      publicPort: 8443,
    })
  })

  it('says it is off before it says anything is missing', () => {
    expect(publicOriginStateOf({ ...configured, isEnabled: false, hostname: null })).toEqual({
      state: PUBLIC_ORIGIN_STATES.disabled,
    })
    expect(publicOriginStateOf({ ...configured, hostname: null })).toEqual({
      state: PUBLIC_ORIGIN_STATES.unconfigured,
    })
    expect(publicOriginStateOf({ ...configured, publicPort: null })).toEqual({
      state: PUBLIC_ORIGIN_STATES.unconfigured,
    })
  })
})

describe('checkFactsOf', () => {
  const facts = {
    publicAddress: '203.0.113.9',
    resolved: ['203.0.113.9'],
    checkedAt: '2026-11-04T00:00:00.000Z',
  }

  it('gives what a check saw, reachable or not', () => {
    expect(
      checkFactsOf({
        state: REMOTE_ACCESS_STATES.reachable,
        isClientAddressForwarded: true,
        ...facts,
      }),
    ).toEqual(facts)
    expect(
      checkFactsOf({
        state: REMOTE_ACCESS_STATES.unreachable,
        problem: REACHABILITY_PROBLEMS.timeout,
        ...facts,
      }),
    ).toEqual(facts)
  })

  it('is null for a status no check made', () => {
    expect(checkFactsOf({ state: REMOTE_ACCESS_STATES.disabled })).toBeNull()
    expect(checkFactsOf({ state: REMOTE_ACCESS_STATES.unconfigured })).toBeNull()
    expect(checkFactsOf({ state: REMOTE_ACCESS_STATES.unchecked })).toBeNull()
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
    expect(isAwayPlay(AT_HOME)).toBe(false)
  })
})

describe('remoteLimitApplies', () => {
  const limited = { limit: 'medium720', isOutside: true } as const

  it('is a play away from home from a server that names a limit', () => {
    expect(
      remoteLimitApplies({ origin: { kind: MEDIA_ORIGIN_KINDS.public }, remote: limited }),
    ).toBe(true)
    expect(remoteLimitApplies({ origin: null, remote: limited })).toBe(true)
  })

  it('is not a play at home, one with no limit, or one from a server that says nothing', () => {
    expect(remoteLimitApplies({ origin: { kind: MEDIA_ORIGIN_KINDS.lan }, remote: limited })).toBe(
      false,
    )
    expect(remoteLimitApplies({ origin: null, remote: { ...limited, isOutside: false } })).toBe(
      false,
    )
    expect(
      remoteLimitApplies({
        origin: { kind: MEDIA_ORIGIN_KINDS.public },
        remote: { ...limited, limit: null },
      }),
    ).toBe(false)
    expect(remoteLimitApplies({ origin: { kind: MEDIA_ORIGIN_KINDS.public }, remote: null })).toBe(
      false,
    )
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
    expect(remoteTranscodeFor({ media: big, origin: away, remote: null })).toBeNull()
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

  it('starts with the transcode, the rest behind it, and leaves the size to the server', () => {
    expect(planForNetwork({ plan, ...props })).toEqual({
      modes: [PLAYBACK_MODES.transcode, PLAYBACK_MODES.direct, PLAYBACK_MODES.remux],
      problems: [],
    })
  })

  it('keeps a plan that can not transcode, and one at home', () => {
    const noTranscode = { modes: [PLAYBACK_MODES.direct], problems: [] }
    expect(planForNetwork({ plan: noTranscode, ...props })).toEqual(noTranscode)
    expect(planForNetwork({ plan, ...props, origin: { kind: MEDIA_ORIGIN_KINDS.lan } })).toEqual(
      plan,
    )
  })
})

describe('the media origins answer', () => {
  it('takes the remote limit, and an older server that sends none', () => {
    expect(isMediaOrigins({ origins: [] })).toBe(true)
    expect(isMediaOrigins({ origins: [], remote: { limit: 'low720', isOutside: true } })).toBe(true)
    expect(isMediaOrigins({ origins: [], remote: { limit: 'huge', isOutside: true } })).toBe(false)
  })
})

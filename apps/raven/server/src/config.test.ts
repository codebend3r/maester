import { describe, expect, it } from 'vitest'
import { ACCOUNTS_OPT_OUT, AUTH_ENV } from '@/auth/authConfig'
import { MUSIC_ENV, readServerConfig } from '@/config'

describe('readServerConfig', () => {
  it('keeps 20 GiB of track transcodes unless TRANSCODE_CACHE_GB says otherwise', () => {
    const gib = 1024 ** 3
    expect(readServerConfig({})).toMatchObject({ transcodeCacheBytes: 20 * gib })
    expect(readServerConfig({ [MUSIC_ENV.transcodeCacheGb]: '5' })).toMatchObject({
      transcodeCacheBytes: 5 * gib,
    })
    expect(readServerConfig({ [MUSIC_ENV.transcodeCacheGb]: 'lots' })).toMatchObject({
      transcodeCacheBytes: 20 * gib,
    })
  })

  it('measures loudness unless LOUDNESS_SCAN turns it off', () => {
    expect(readServerConfig({})).toMatchObject({ loudnessScan: true })
    expect(readServerConfig({ [MUSIC_ENV.loudnessScan]: 'off' })).toMatchObject({
      loudnessScan: false,
    })
  })

  it('leaves Last.fm off until both its key and its secret are set', () => {
    expect(readServerConfig({}).lastFm).toBeNull()
    expect(readServerConfig({ [MUSIC_ENV.lastFmApiKey]: 'key' }).lastFm).toBeNull()
    expect(
      readServerConfig({ [MUSIC_ENV.lastFmApiKey]: 'key', [MUSIC_ENV.lastFmApiSecret]: '  ' })
        .lastFm,
    ).toBeNull()
    expect(
      readServerConfig({ [MUSIC_ENV.lastFmApiKey]: ' key ', [MUSIC_ENV.lastFmApiSecret]: 'secret' })
        .lastFm,
    ).toEqual({ apiKey: 'key', apiSecret: 'secret' })
  })

  it('quick-scans on boot and every 10 minutes unless told otherwise', () => {
    expect(readServerConfig({})).toMatchObject({ scanOnStart: true, quickScanIntervalMinutes: 10 })
    expect(
      readServerConfig({ SCAN_ON_START: 'false', QUICK_SCAN_INTERVAL_MINUTES: '0' }),
    ).toMatchObject({ scanOnStart: false, quickScanIntervalMinutes: 0 })
  })

  it('holds ten titles in the hero unless HERO_COUNT says otherwise, and never fewer than one', () => {
    expect(readServerConfig({})).toMatchObject({ heroCount: 10 })
    expect(readServerConfig({ HERO_COUNT: '4' })).toMatchObject({ heroCount: 4 })
    expect(readServerConfig({ HERO_COUNT: '0' })).toMatchObject({ heroCount: 1 })
    expect(readServerConfig({ HERO_COUNT: 'many' })).toMatchObject({ heroCount: 10 })
  })

  it('leaves the AI lookup off without a key, on Haiku 5.5 at low effort, 200 a day', () => {
    expect(readServerConfig({})).toMatchObject({
      anthropicApiKey: null,
      aiMatchModel: 'claude-haiku-5-5',
      aiMatchEffort: 'low',
      aiDailyLimit: 200,
    })
  })

  it('reads the key, the model, the effort and the limit', () => {
    expect(
      readServerConfig({
        ANTHROPIC_API_KEY: ' sk-ant-raven ',
        AI_MATCH_MODEL: 'claude-sonnet-5-5',
        AI_MATCH_EFFORT: 'medium',
        AI_DAILY_LIMIT: '50',
      }),
    ).toMatchObject({
      anthropicApiKey: 'sk-ant-raven',
      aiMatchModel: 'claude-sonnet-5-5',
      aiMatchEffort: 'medium',
      aiDailyLimit: 50,
    })
  })

  it('takes an empty key as none, an effort it does not know as low, and at least one lookup a day', () => {
    expect(
      readServerConfig({
        ANTHROPIC_API_KEY: '  ',
        AI_MATCH_EFFORT: 'extreme',
        AI_DAILY_LIMIT: '0',
      }),
    ).toMatchObject({ anthropicApiKey: null, aiMatchEffort: 'low', aiDailyLimit: 1 })
  })

  it('leaves MDBList off without a key, at 1,000 calls a day', () => {
    expect(readServerConfig({})).toMatchObject({ mdblistApiKey: null, mdblistDailyLimit: 1000 })
  })

  it('reads the MDBList key trimmed and its limit, an empty key as none and at least one call a day', () => {
    expect(
      readServerConfig({ MDBLIST_API_KEY: ' mdb-key ', MDBLIST_DAILY_LIMIT: '250' }),
    ).toMatchObject({ mdblistApiKey: 'mdb-key', mdblistDailyLimit: 250 })
    expect(readServerConfig({ MDBLIST_API_KEY: '  ', MDBLIST_DAILY_LIMIT: '0' })).toMatchObject({
      mdblistApiKey: null,
      mdblistDailyLimit: 1,
    })
  })

  it('has no media plane until its variables are set', () => {
    expect(readServerConfig({}).mediaPlane).toEqual({
      origins: [],
      webOrigins: [],
      secret: null,
      problems: [],
      secretProblems: [],
    })
  })

  it('opts out of accounts only for exactly the opt-out value', () => {
    expect(readServerConfig({}).isAccountsOptedOut).toBe(false)
    expect(readServerConfig({ [AUTH_ENV.accounts]: ACCOUNTS_OPT_OUT }).isAccountsOptedOut).toBe(
      true,
    )
    expect(
      ['', 'on', 'OFF', ' off', 'false', '0'].map(
        (value) => readServerConfig({ [AUTH_ENV.accounts]: value }).isAccountsOptedOut,
      ),
    ).toEqual([false, false, false, false, false, false])
  })
})

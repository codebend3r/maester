import { describe, expect, it } from 'bun:test'
import { HTTP_METHODS } from '@shared/http'
import type { FetchResponse } from '@/apiClient'
import {
  AUTH_HEADERS,
  DEVICE_CLAIM_STATUSES,
  cleanDeviceCode,
  shownDeviceCode,
  spokenDeviceCode,
} from '@/contract'
import { createDeviceSignInClient, deviceLinkUrl } from '@/deviceSignIn'
import { type Call, respond } from '@/test/apiClientFakes'

const SUPABASE = 'https://project.supabase.co/'
const KEY = 'sb_publishable_test'
const DEVICE_CODE = 'a'.repeat(64)

const started = {
  device_code: DEVICE_CODE,
  user_code: 'BCDFGHJK',
  expires_in: 600,
  poll_interval: 5,
}

const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 3600,
  userId: 'user-1',
  email: 'friend@maester.test',
}

const clientWith = (response: FetchResponse | Error) => {
  const calls: Call[] = []
  const client = createDeviceSignInClient({
    supabaseUrl: SUPABASE,
    publishableKey: KEY,
    fetch: async (url, init) => {
      calls.push({ url, init })
      if (response instanceof Error) throw response
      return response
    },
  })
  return { client, calls }
}

describe('cleanDeviceCode', () => {
  it('reads a code in any case, with or without its dash', () => {
    expect(cleanDeviceCode('bcdf-ghjk')).toBe('BCDFGHJK')
    expect(cleanDeviceCode(' BCDF GHJK ')).toBe('BCDFGHJK')
  })

  it('refuses what is not a whole code', () => {
    expect(cleanDeviceCode('BCDF')).toBeNull()
    expect(cleanDeviceCode('ABCDEFGH')).toBeNull()
    expect(cleanDeviceCode('')).toBeNull()
  })
})

describe('spokenDeviceCode', () => {
  it('spells a shown code out a letter at a time, without its dash', () => {
    expect(spokenDeviceCode('BCDF-GHJK')).toBe('B C D F G H J K')
  })
})

describe('deviceLinkUrl', () => {
  it('holds the code as it is shown, on the web address', () => {
    expect(shownDeviceCode('BCDFGHJK')).toBe('BCDF-GHJK')
    expect(deviceLinkUrl({ webUrl: 'https://raven.example/', code: 'BCDFGHJK' })).toBe(
      'https://raven.example/link?code=BCDF-GHJK',
    )
  })

  it('is the bare page for an address typed by hand', () => {
    expect(deviceLinkUrl({ webUrl: 'https://raven.example' })).toBe('https://raven.example/link')
  })
})

describe('createDeviceSignInClient', () => {
  it('starts a sign-in signed out, with the publishable key alone', async () => {
    const { client, calls } = clientWith(respond({ body: [started] }))
    expect(await client.start({ deviceName: 'Raven on Apple TV' })).toEqual({
      deviceCode: DEVICE_CODE,
      userCode: 'BCDFGHJK',
      expiresInMs: 600_000,
      pollMs: 5000,
    })
    expect(calls[0]!.url).toBe('https://project.supabase.co/rest/v1/rpc/start_device_sign_in')
    expect(calls[0]!.init).toMatchObject({
      method: HTTP_METHODS.post,
      headers: { [AUTH_HEADERS.apiKey]: KEY },
      body: JSON.stringify({ device_name: 'Raven on Apple TV' }),
    })
    expect(calls[0]!.init?.headers).not.toHaveProperty(AUTH_HEADERS.authorization)
  })

  it('offers no code when the database has no such function or does not answer', async () => {
    expect(
      await clientWith(respond({ status: 404, body: { message: 'Not found' } })).client.start({
        deviceName: 'TV',
      }),
    ).toBeNull()
    expect(await clientWith(new Error('offline')).client.start({ deviceName: 'TV' })).toBeNull()
    expect(
      await clientWith(respond({ body: [{ ...started, user_code: 'nope' }] })).client.start({
        deviceName: 'TV',
      }),
    ).toBeNull()
  })

  it('asks the Edge Function with the device code', async () => {
    const { client, calls } = clientWith(
      respond({ body: { status: DEVICE_CLAIM_STATUSES.approved, session } }),
    )
    expect(await client.claim({ deviceCode: DEVICE_CODE })).toEqual({
      status: DEVICE_CLAIM_STATUSES.approved,
      session,
    })
    expect(calls[0]!.url).toBe('https://project.supabase.co/functions/v1/device-sign-in')
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ deviceCode: DEVICE_CODE }))
  })

  it('reads pending and gone, and an ask with no answer as null', async () => {
    const pending = { status: DEVICE_CLAIM_STATUSES.pending }
    expect(
      await clientWith(respond({ body: pending })).client.claim({ deviceCode: DEVICE_CODE }),
    ).toEqual(pending)
    expect(
      await clientWith(respond({ status: 502, body: null })).client.claim({
        deviceCode: DEVICE_CODE,
      }),
    ).toBeNull()
    expect(
      await clientWith(respond({ body: { status: DEVICE_CLAIM_STATUSES.approved } })).client.claim({
        deviceCode: DEVICE_CODE,
      }),
    ).toBeNull()
  })
})

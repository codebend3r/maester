import { describe, expect, it } from 'bun:test'
import { HEADERS, HTTP_METHODS, HTTP_STATUSES } from '@shared/http'
import { createAccountDataClient } from '@/accountData'
import { ApiError, type FetchResponse } from '@/apiClient'
import { AUTH_HEADERS, AUTH_SCHEME } from '@/contract'
import { type Call, respond } from '@/test/apiClientFakes'

const SUPABASE = 'https://project.supabase.co/'
const KEY = 'sb_publishable_test'
const TOKEN = 'access-token'
const SERVER_ID = '30000000-0000-4000-8000-000000000001'

const server = {
  id: '40000000-0000-4000-8000-000000000001',
  serverId: SERVER_ID,
  name: 'Meleys',
  origin: 'https://meleys.example:8443',
  addedAt: '2026-11-23T10:00:00+00:00',
}

const pin = { serverId: SERVER_ID, libraryId: 2, pinnedAt: '2026-11-23T10:00:00+00:00' }

type ClientProps = { response: FetchResponse; token?: string | null }

const clientWith = ({ response, token = TOKEN }: ClientProps) => {
  const calls: Call[] = []
  const client = createAccountDataClient({
    supabaseUrl: SUPABASE,
    publishableKey: KEY,
    accessToken: async () => token,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return response
    },
  })
  return { client, calls }
}

const decoded = (url: string): string => decodeURIComponent(url)

describe('createAccountDataClient', () => {
  it('lists the servers with the publishable key and the account token, renamed to the contract', async () => {
    const { client, calls } = clientWith({ response: respond({ body: [server] }) })
    expect(await client.listServers()).toEqual([server])
    expect(decoded(calls[0]!.url)).toBe(
      'https://project.supabase.co/rest/v1/account_servers?select=id,serverId:server_id,name,origin,addedAt:added_at&order=added_at.asc',
    )
    expect(calls[0]!.init).toMatchObject({
      method: HTTP_METHODS.get,
      headers: {
        [AUTH_HEADERS.apiKey]: KEY,
        [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${TOKEN}`,
      },
    })
  })

  it('sends no Bearer while signed out', async () => {
    const { client, calls } = clientWith({ response: respond({ body: [] }), token: null })
    await client.listPins()
    expect(calls[0]!.init?.headers).not.toHaveProperty(AUTH_HEADERS.authorization)
    expect(calls[0]!.init?.headers).toHaveProperty(AUTH_HEADERS.apiKey, KEY)
  })

  it('leaves out a row it does not understand and keeps the rest', async () => {
    const { client } = clientWith({
      response: respond({ body: [server, { ...server, origin: 'not an origin' }] }),
    })
    expect(await client.listServers()).toEqual([server])
  })

  it('refuses a list answer that is not a list', async () => {
    const { client } = clientWith({ response: respond({ body: { rows: [] } }) })
    await expect(client.listServers()).rejects.toBeInstanceOf(ApiError)
  })

  it('adds a server with its name tidied and its address as serverOriginOf reads it', async () => {
    const { client, calls } = clientWith({
      response: respond({ status: HTTP_STATUSES.created, body: [server] }),
    })
    const added = await client.addServer({
      serverId: SERVER_ID,
      name: '  Meleys ',
      origin: 'HTTPS://Meleys.Example:8443/',
    })
    expect(added).toEqual(server)
    expect(calls[0]!.init?.method).toBe(HTTP_METHODS.post)
    expect(calls[0]!.init?.headers).toHaveProperty(HEADERS.prefer, 'return=representation')
    expect(JSON.parse(calls[0]!.init?.body ?? '')).toEqual({
      server_id: SERVER_ID,
      name: 'Meleys',
      origin: 'https://meleys.example:8443',
    })
  })

  it('refuses a blank name or an address that is not an origin before sending', async () => {
    const { client, calls } = clientWith({ response: respond({ body: [server] }) })
    await expect(
      client.addServer({ serverId: SERVER_ID, name: '   ', origin: 'https://meleys.example' }),
    ).rejects.toMatchObject({ status: HTTP_STATUSES.badRequest })
    await expect(
      client.addServer({
        serverId: SERVER_ID,
        name: 'Meleys',
        origin: 'https://meleys.example/api',
      }),
    ).rejects.toMatchObject({ status: HTTP_STATUSES.badRequest })
    expect(calls).toEqual([])
  })

  it('renames a server by its row id', async () => {
    const renamed = { ...server, name: 'Meleys at home' }
    const { client, calls } = clientWith({ response: respond({ body: [renamed] }) })
    expect(await client.renameServer({ id: server.id, name: 'Meleys at home' })).toEqual(renamed)
    expect(decoded(calls[0]!.url)).toStartWith(
      `https://project.supabase.co/rest/v1/account_servers?id=eq.${server.id}&select=`,
    )
    expect(calls[0]!.init?.method).toBe(HTTP_METHODS.patch)
    expect(JSON.parse(calls[0]!.init?.body ?? '')).toEqual({ name: 'Meleys at home' })
  })

  it('says a rename matched no server of the account', async () => {
    const { client } = clientWith({ response: respond({ body: [] }) })
    await expect(client.renameServer({ id: server.id, name: 'Gone' })).rejects.toMatchObject({
      status: HTTP_STATUSES.notFound,
    })
  })

  it('removes a server by its row id', async () => {
    const { client, calls } = clientWith({ response: respond({ status: HTTP_STATUSES.noContent }) })
    await client.removeServer({ id: server.id })
    expect(decoded(calls[0]!.url)).toBe(
      `https://project.supabase.co/rest/v1/account_servers?id=eq.${server.id}`,
    )
    expect(calls[0]!.init?.method).toBe(HTTP_METHODS.delete)
  })

  it('lists the pins, oldest first', async () => {
    const { client, calls } = clientWith({ response: respond({ body: [pin] }) })
    expect(await client.listPins()).toEqual([pin])
    expect(decoded(calls[0]!.url)).toBe(
      'https://project.supabase.co/rest/v1/library_pins?select=serverId:server_id,libraryId:library_id,pinnedAt:pinned_at&order=pinned_at.asc',
    )
  })

  it('pins a library, keeping a pin already there', async () => {
    const { client, calls } = clientWith({ response: respond({ status: HTTP_STATUSES.created }) })
    await client.pinLibrary({ serverId: SERVER_ID, libraryId: 2 })
    expect(calls[0]!.url).toBe('https://project.supabase.co/rest/v1/library_pins')
    expect(calls[0]!.init?.headers).toHaveProperty(
      HEADERS.prefer,
      'resolution=ignore-duplicates,return=minimal',
    )
    expect(JSON.parse(calls[0]!.init?.body ?? '')).toEqual({ server_id: SERVER_ID, library_id: 2 })
  })

  it('unpins a library by its server and id', async () => {
    const { client, calls } = clientWith({ response: respond({ status: HTTP_STATUSES.noContent }) })
    await client.unpinLibrary({ serverId: SERVER_ID, libraryId: 2 })
    expect(decoded(calls[0]!.url)).toBe(
      `https://project.supabase.co/rest/v1/library_pins?server_id=eq.${SERVER_ID}&library_id=eq.2`,
    )
    expect(calls[0]!.init?.method).toBe(HTTP_METHODS.delete)
  })

  it('names a server by upserting on the account and the server', async () => {
    const named = { serverId: SERVER_ID, name: 'Vhagar' }
    const { client, calls } = clientWith({ response: respond({ body: [named] }) })
    expect(await client.nameServer({ serverId: SERVER_ID, name: ' Vhagar ' })).toEqual(named)
    expect(decoded(calls[0]!.url)).toBe(
      'https://project.supabase.co/rest/v1/server_names?on_conflict=user_id,server_id&select=serverId:server_id,name',
    )
    expect(calls[0]!.init?.method).toBe(HTTP_METHODS.post)
    expect(calls[0]!.init?.headers).toHaveProperty(
      HEADERS.prefer,
      'resolution=merge-duplicates,return=representation',
    )
    expect(JSON.parse(calls[0]!.init?.body ?? '')).toEqual({ server_id: SERVER_ID, name: 'Vhagar' })
  })

  it('refuses a blank server name before sending', async () => {
    const { client, calls } = clientWith({ response: respond({ body: [] }) })
    await expect(client.nameServer({ serverId: SERVER_ID, name: ' ' })).rejects.toMatchObject({
      status: HTTP_STATUSES.badRequest,
    })
    expect(calls).toEqual([])
  })

  it('lists the server names', async () => {
    const named = { serverId: SERVER_ID, name: 'Vhagar' }
    const { client, calls } = clientWith({ response: respond({ body: [named] }) })
    expect(await client.listServerNames()).toEqual([named])
    expect(decoded(calls[0]!.url)).toBe(
      'https://project.supabase.co/rest/v1/server_names?select=serverId:server_id,name&order=named_at.asc',
    )
  })

  it('reads the defaults for an account with no preferences row', async () => {
    const { client } = clientWith({ response: respond({ body: [] }) })
    expect(await client.readPreferences()).toEqual({ showPinServers: true })
  })

  it('reads the preferences the account kept', async () => {
    const { client } = clientWith({ response: respond({ body: [{ showPinServers: false }] }) })
    expect(await client.readPreferences()).toEqual({ showPinServers: false })
  })

  it('writes the preferences by upserting on the account', async () => {
    const { client, calls } = clientWith({
      response: respond({ body: [{ showPinServers: false }] }),
    })
    expect(await client.setPreferences({ showPinServers: false })).toEqual({
      showPinServers: false,
    })
    expect(decoded(calls[0]!.url)).toBe(
      'https://project.supabase.co/rest/v1/account_preferences?on_conflict=user_id&select=showPinServers:show_pin_servers',
    )
    expect(JSON.parse(calls[0]!.init?.body ?? '')).toEqual({ show_pin_servers: false })
  })

  it('fails with the database message when it refuses', async () => {
    const { client } = clientWith({
      response: respond({
        status: HTTP_STATUSES.badRequest,
        body: { code: '23514', message: 'At most 20 servers per account' },
      }),
    })
    await expect(
      client.addServer({ serverId: SERVER_ID, name: 'One more', origin: 'https://more.example' }),
    ).rejects.toMatchObject({
      status: HTTP_STATUSES.badRequest,
      message: 'At most 20 servers per account',
    })
  })
})

import { describe, expect, it } from 'bun:test'
import { isAccountServer, isLibraryPin } from '@/contract/accountServers'

const SERVER_ID = '30000000-0000-4000-8000-000000000001'

describe('isAccountServer', () => {
  const server = {
    id: '40000000-0000-4000-8000-000000000001',
    serverId: SERVER_ID,
    name: 'Meleys',
    origin: 'https://meleys.example:8443',
    addedAt: '2026-11-23T10:00:00+00:00',
  }

  it('takes a row with a uuid server id and a bare origin', () => {
    expect(isAccountServer(server)).toBe(true)
  })

  it('refuses a server id that is not a uuid, or an origin with a path', () => {
    expect(isAccountServer({ ...server, serverId: 'meleys' })).toBe(false)
    expect(isAccountServer({ ...server, origin: 'https://meleys.example/api' })).toBe(false)
  })
})

describe('isLibraryPin', () => {
  it('takes a library id from 1 on a server', () => {
    expect(isLibraryPin({ serverId: SERVER_ID, libraryId: 2, pinnedAt: 'now' })).toBe(true)
    expect(isLibraryPin({ serverId: SERVER_ID, libraryId: 0, pinnedAt: 'now' })).toBe(false)
  })
})

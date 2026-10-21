import { describe, expect, it } from 'bun:test'
import { NAME_MAX } from '@/names'
import { SERVERS_CAP, renamedServers, serverNameFor } from '@/serverList'

describe('SERVERS_CAP', () => {
  it('is twenty', () => {
    expect(SERVERS_CAP).toBe(20)
  })
})

describe('serverNameFor', () => {
  it('is the host of the origin', () => {
    expect(serverNameFor('https://raven.example.ts.net')).toBe('raven.example.ts.net')
  })

  it('keeps a port that is not the default', () => {
    expect(serverNameFor('http://127.0.0.1:8080')).toBe('127.0.0.1:8080')
    expect(serverNameFor('http://[::1]:3000')).toBe('[::1]:3000')
  })

  it('shows an international name as punycode', () => {
    expect(serverNameFor('https://xn--rven-pqa.example')).toBe('xn--rven-pqa.example')
  })
})

describe('renamedServers', () => {
  const den = { id: 'den', name: 'nas:8080', origin: 'http://nas:8080' }
  const loft = { id: 'loft', name: 'loft:8080', origin: 'http://loft:8080' }

  it('gives the server the name typed, tidied, and leaves the rest as they are', () => {
    expect(renamedServers({ servers: [den, loft], id: loft.id, name: '  Living   room ' })).toEqual(
      [den, { ...loft, name: 'Living room' }],
    )
  })

  it('refuses a blank name, one too long, and a server not on the list', () => {
    expect(renamedServers({ servers: [den], id: den.id, name: '   ' })).toBeNull()
    expect(
      renamedServers({ servers: [den], id: den.id, name: 'a'.repeat(NAME_MAX + 1) }),
    ).toBeNull()
    expect(renamedServers({ servers: [den], id: loft.id, name: 'Den' })).toBeNull()
  })
})

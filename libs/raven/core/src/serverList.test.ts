import { describe, expect, it } from 'bun:test'
import { SERVERS_CAP, serverNameFor } from '@/serverList'

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

import { describe, expect, it } from 'bun:test'
import { webAppAddress } from '@/pages/GetPage/links'

const origin = 'https://raven.example'

describe('webAppAddress', () => {
  it('goes to the address as typed', () => {
    expect(webAppAddress({ typed: 'https://raven.home:8096', origin })).toBe(
      'https://raven.home:8096/',
    )
    expect(webAppAddress({ typed: '  http://nas.local/libraries ', origin })).toBe(
      'http://nas.local/libraries',
    )
  })

  it("puts this page's scheme on an address typed without one", () => {
    expect(webAppAddress({ typed: 'raven.home:8096', origin })).toBe('https://raven.home:8096/')
    expect(webAppAddress({ typed: 'nas.local', origin: 'http://localhost:5173' })).toBe(
      'http://nas.local/',
    )
  })

  it("goes to this server's home while the field is blank or not a web address", () => {
    expect(webAppAddress({ typed: '', origin })).toBe('https://raven.example/')
    expect(webAppAddress({ typed: '   ', origin })).toBe('https://raven.example/')
    expect(webAppAddress({ typed: 'javascript:alert(1)', origin })).toBe('https://raven.example/')
    expect(webAppAddress({ typed: 'ftp://files.example', origin })).toBe('https://raven.example/')
    expect(webAppAddress({ typed: 'http://', origin })).toBe('https://raven.example/')
  })
})

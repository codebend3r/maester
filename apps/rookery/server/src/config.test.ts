import { describe, expect, it } from 'vitest'
import { ConfigError, readServerConfig } from '@/config.js'

const required = { PUBLIC_URL: 'https://rookery.maester.example.com/', SERVICE_TOKEN: 's3cret' }

describe('readServerConfig', () => {
  it('stops on boot naming every missing required variable', () => {
    expect(() => readServerConfig({})).toThrow(
      new ConfigError('missing required environment: PUBLIC_URL, SERVICE_TOKEN'),
    )
  })

  it('refuses a public URL or app origin that is not http(s)', () => {
    expect(() =>
      readServerConfig({ ...required, PUBLIC_URL: 'rookery', APP_ORIGINS: 'ftp://x' }),
    ).toThrow('not an http(s) URL: PUBLIC_URL (rookery), APP_ORIGINS (ftp://x)')
  })

  it('reads the rest with defaults', () => {
    const config = readServerConfig({
      ...required,
      APP_ORIGINS: 'https://luwin.maester.example.com/, https://raven.maester.example.com',
      COOKIE_DOMAIN: '.maester.example.com',
    })
    expect(config).toMatchObject({
      port: 8030,
      publicUrl: 'https://rookery.maester.example.com',
      serviceToken: 's3cret',
      appOrigins: ['https://luwin.maester.example.com', 'https://raven.maester.example.com'],
      cookieDomain: 'maester.example.com',
      secureCookies: true,
      webDir: null,
    })
  })

  it('leaves cookies insecure for a plain http address, as in development', () => {
    const config = readServerConfig({ ...required, PUBLIC_URL: 'http://localhost:5180' })
    expect(config.secureCookies).toBe(false)
    expect(config.cookieDomain).toBeNull()
  })
})

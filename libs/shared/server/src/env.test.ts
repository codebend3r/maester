import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { flag, LISTEN_ENV_VARS, readListenConfig, wholeNumber } from '@/env'

describe('wholeNumber', () => {
  it('reads a whole number at or above zero', () => {
    expect(wholeNumber('0')).toBe(0)
    expect(wholeNumber(' 8484 ')).toBe(8484)
  })

  it('is null for anything else, blank included', () => {
    expect([undefined, '', '  ', '-1', '1.5', 'eight'].map(wholeNumber)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ])
  })
})

describe('flag', () => {
  it('reads the usual spellings of yes and no, in any case', () => {
    expect(['1', 'true', 'YES', ' on '].map((value) => flag({ value, fallback: false }))).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(['0', 'false', 'No', 'OFF'].map((value) => flag({ value, fallback: true }))).toEqual([
      false,
      false,
      false,
      false,
    ])
  })

  it('falls back on anything else', () => {
    expect(flag({ value: undefined, fallback: true })).toBe(true)
    expect(flag({ value: 'maybe', fallback: false })).toBe(false)
  })
})

describe('readListenConfig', () => {
  it('listens everywhere on the default port, with data beside the process and no web app', () => {
    expect(readListenConfig({ env: {}, defaultPort: 8030 })).toEqual({
      port: 8030,
      host: '0.0.0.0',
      dataDir: resolve('./data'),
      webDir: null,
    })
  })

  it('reads PORT, HOST, DATA_DIR and WEB_DIR, resolving the folders', () => {
    const env = {
      [LISTEN_ENV_VARS.port]: '9000',
      [LISTEN_ENV_VARS.host]: ' 127.0.0.1 ',
      [LISTEN_ENV_VARS.dataDir]: '/config',
      [LISTEN_ENV_VARS.webDir]: 'web',
    }
    expect(readListenConfig({ env, defaultPort: 8030 })).toEqual({
      port: 9000,
      host: '127.0.0.1',
      dataDir: '/config',
      webDir: resolve('web'),
    })
  })

  it('keeps the default port for a PORT that is not a whole number, and no web app for a blank WEB_DIR', () => {
    const config = readListenConfig({
      env: { [LISTEN_ENV_VARS.port]: 'http', [LISTEN_ENV_VARS.webDir]: '  ' },
      defaultPort: 8484,
    })
    expect(config.port).toBe(8484)
    expect(config.webDir).toBeNull()
  })
})

import { describe, expect, it } from 'bun:test'
import { DEFAULT_SERVER_ORIGIN, DESKTOP_ENV } from '@raven/core'
import { AUTH_ORIGIN_HOOK, authOriginFrom, linkOriginsFrom, serverOriginFrom } from '@/main/origins'
import { isServerOrigin } from '@raven/core'

describe('authOriginFrom', () => {
  const HOOK = 'http://127.0.0.1:9000'

  type PickProps = { isPackaged: boolean; env: Record<string, string | undefined> }

  const pick = (input: PickProps) => {
    const warnings: string[] = []
    const origin = authOriginFrom({ ...input, warn: (message) => warnings.push(message) })
    return { origin, warnings }
  }

  it('reads the hook only unpackaged', () => {
    expect(pick({ isPackaged: false, env: { [AUTH_ORIGIN_HOOK]: HOOK } })).toEqual({
      origin: HOOK,
      warnings: [],
    })
    expect(pick({ isPackaged: true, env: { [AUTH_ORIGIN_HOOK]: HOOK } })).toEqual({
      origin: null,
      warnings: [],
    })
  })

  it('names none when the hook is unset or empty', () => {
    expect(pick({ isPackaged: false, env: {} })).toEqual({ origin: null, warnings: [] })
    expect(pick({ isPackaged: false, env: { [AUTH_ORIGIN_HOOK]: '' } })).toEqual({
      origin: null,
      warnings: [],
    })
  })

  it.each(["'unsafe-inline'", 'http://127.0.0.1:9000/auth', '*', 'https://a.example b.example'])(
    'warns and names none for %p, which is not an origin',
    (value) => {
      const { origin, warnings } = pick({ isPackaged: false, env: { [AUTH_ORIGIN_HOOK]: value } })
      expect(origin).toBeNull()
      expect(warnings).toHaveLength(1)
    },
  )
})

describe('isServerOrigin', () => {
  it.each(['https://raven.example.ts.net', 'http://192.168.50.6:8484', DEFAULT_SERVER_ORIGIN])(
    'accepts %p',
    (origin) => {
      expect(isServerOrigin(origin)).toBe(true)
    },
  )

  it.each([
    'https://raven.example/',
    'https://raven.example/api',
    'https://raven.example?x=1',
    'https://user:pass@raven.example',
    'ftp://raven.example',
    'raven.example',
    '',
    undefined,
    42,
  ])('refuses %p', (origin) => {
    expect(isServerOrigin(origin)).toBe(false)
  })
})

describe('serverOriginFrom', () => {
  const BUILT = 'https://raven.example.ts.net'
  const HOOK = 'http://127.0.0.1:9000'

  type PickProps = {
    isPackaged: boolean
    built: string | undefined
    env: Record<string, string | undefined>
  }

  const pick = (input: PickProps) => {
    const warnings: string[] = []
    const origin = serverOriginFrom({ ...input, warn: (message) => warnings.push(message) })
    return { origin, warnings }
  }

  it('uses the built origin when packaged, whatever the environment says', () => {
    expect(
      pick({ isPackaged: true, built: BUILT, env: { [DESKTOP_ENV.serverOrigin]: HOOK } }),
    ).toEqual({ origin: BUILT, warnings: [] })
  })

  it('falls back to the default server when the build named none', () => {
    expect(pick({ isPackaged: true, built: '', env: {} })).toEqual({
      origin: DEFAULT_SERVER_ORIGIN,
      warnings: [],
    })
    expect(pick({ isPackaged: true, built: undefined, env: {} }).origin).toBe(DEFAULT_SERVER_ORIGIN)
  })

  it('warns and falls back when the build named something that is not an origin', () => {
    const { origin, warnings } = pick({ isPackaged: true, built: 'raven.example/api', env: {} })
    expect(origin).toBe(DEFAULT_SERVER_ORIGIN)
    expect(warnings).toHaveLength(1)
  })

  it('lets an unpackaged run point at another server', () => {
    expect(
      pick({ isPackaged: false, built: BUILT, env: { [DESKTOP_ENV.serverOrigin]: HOOK } }),
    ).toEqual({ origin: HOOK, warnings: [] })
  })

  it('ignores an empty or malformed test hook', () => {
    expect(
      pick({ isPackaged: false, built: BUILT, env: { [DESKTOP_ENV.serverOrigin]: '' } }).origin,
    ).toBe(BUILT)
    const malformed = pick({
      isPackaged: false,
      built: BUILT,
      env: { [DESKTOP_ENV.serverOrigin]: 'http://127.0.0.1:9000/api' },
    })
    expect(malformed.origin).toBe(BUILT)
    expect(malformed.warnings).toHaveLength(1)
  })
})

describe('linkOriginsFrom', () => {
  type PickProps = {
    isPackaged: boolean
    built: string | undefined
    env: Record<string, string | undefined>
  }

  const pick = (input: PickProps) => {
    const warnings: string[] = []
    const origins = linkOriginsFrom({ ...input, warn: (message) => warnings.push(message) })
    return { origins, warnings }
  }

  it("reads the build's list, trimmed, as origins, each once", () => {
    expect(
      pick({
        isPackaged: true,
        built: ' http://192.168.50.6:8484, https://raven.example/ ,http://192.168.50.6:8484',
        env: { [DESKTOP_ENV.linkOrigins]: 'http://127.0.0.1:9000' },
      }),
    ).toEqual({
      origins: ['http://192.168.50.6:8484', 'https://raven.example'],
      warnings: [],
    })
  })

  it('names none when the build named none', () => {
    expect(pick({ isPackaged: true, built: '', env: {} }).origins).toEqual([])
    expect(pick({ isPackaged: true, built: undefined, env: {} }).origins).toEqual([])
  })

  it('lets an unpackaged run replace the list', () => {
    expect(
      pick({
        isPackaged: false,
        built: 'https://raven.example',
        env: { [DESKTOP_ENV.linkOrigins]: 'http://127.0.0.1:9000' },
      }).origins,
    ).toEqual(['http://127.0.0.1:9000'])
  })

  it('leaves out an entry that is not an origin, with one warning', () => {
    expect(
      pick({ isPackaged: true, built: 'https://raven.example/api,ftp://x,raven.example', env: {} }),
    ).toEqual({
      origins: [],
      warnings: ['Raven ignored 3 of RAVEN_DESKTOP_LINK_ORIGINS: not http or https origins.'],
    })
  })
})

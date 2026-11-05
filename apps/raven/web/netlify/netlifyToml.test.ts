import { describe, expect, it } from 'bun:test'
import { DEFAULT_SERVER_ORIGIN, isRecord } from '@raven/core'

const CONFIG = new URL('../netlify.toml', import.meta.url)

/** The `[[redirects]]` rules of the site's `netlify.toml`, in order. */
const redirects = async (): Promise<Record<string, unknown>[]> => {
  const parsed: unknown = Bun.TOML.parse(await Bun.file(CONFIG).text())
  const rules = isRecord(parsed) ? parsed.redirects : null
  return Array.isArray(rules) ? rules.filter(isRecord) : []
}

describe('netlify.toml', () => {
  it("proxies /api first, signed, to raven's public origin, the one Raven's default server names", async () => {
    const [api, fallback] = await redirects()
    expect(api).toEqual({
      from: '/api/*',
      to: `${DEFAULT_SERVER_ORIGIN}/api/:splat`,
      status: 200,
      force: true,
      signed: 'RAVEN_PROXY_SECRET',
    })
    expect(fallback?.from).toBe('/*')
  })
})

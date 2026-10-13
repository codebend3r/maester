import type { Anthropic } from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readServerConfig, type ServerConfig } from '@/config'
import { AiClient, AiError } from '@/metadata/aiClient'
import { fakeClaude } from '@/test/fakeClaude'

const ASK: Anthropic.MessageCreateParamsNonStreaming = {
  model: 'claude-haiku-5-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'Hello' }],
}

const config = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({
  ...readServerConfig({}),
  anthropicApiKey: 'test-key',
  ...overrides,
})

describe('AiClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is off without a key, and never calls out', async () => {
    const claude = fakeClaude({ lookups: {} })
    const ai = new AiClient(config({ anthropicApiKey: null }), claude.fetch)
    expect(ai.enabled).toBe(false)
    expect(ai.take()).toBe(false)
    expect(ai.remaining()).toBe(0)
    expect(ai.state()).toEqual({ state: 'off', error: null })
    await expect(ai.send(ASK)).rejects.toBeInstanceOf(AiError)
    expect(claude.state.requests).toEqual([])
  })

  it("asks with raven's own key, and is ok once answered", async () => {
    const claude = fakeClaude({ lookups: {} })
    const ai = new AiClient(config(), claude.fetch)
    const answer = await ai.send(ASK)
    expect(answer.stop_reason).toBe('end_turn')
    expect(claude.state.requests.map((request) => [request.url, request.apiKey])).toEqual([
      ['https://api.anthropic.com/v1/messages', 'test-key'],
    ])
    expect(ai.state()).toEqual({ state: 'ok', error: null })
  })

  it('counts lookups against the daily limit, and counts again from midnight UTC', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T23:59:00.000Z'))
    const ai = new AiClient(config({ aiDailyLimit: 2 }), fakeClaude({ lookups: {} }).fetch)
    expect([ai.take(), ai.take(), ai.take()]).toEqual([true, true, false])
    expect(ai.remaining()).toBe(0)
    expect(ai.enabled).toBe(false)
    vi.setSystemTime(new Date('2026-10-14T00:00:01.000Z'))
    expect(ai.remaining()).toBe(2)
    expect(ai.take()).toBe(true)
  })

  it('stops until a restart once the key is refused, saying why but never naming the key', async () => {
    const claude = fakeClaude({ lookups: {} })
    claude.state.status = 401
    claude.state.message = 'invalid x-api-key'
    const ai = new AiClient(config(), claude.fetch)
    await expect(ai.send(ASK)).rejects.toThrow(
      'Anthropic refused the key (401: invalid x-api-key). Check ANTHROPIC_API_KEY and restart.',
    )
    expect(ai.enabled).toBe(false)
    expect(ai.remaining()).toBe(0)
    expect(ai.state()).toMatchObject({ state: 'failing' })
    expect(JSON.stringify(ai.state())).not.toContain('test-key')
    claude.state.status = 200
    await expect(ai.send(ASK)).rejects.toBeInstanceOf(AiError)
    expect(claude.state.requests).toHaveLength(1)
  })

  it.each([400, 404])(
    'stops until a restart once Anthropic turns the request down with %i, as for a model it does not know',
    async (status) => {
      const claude = fakeClaude({ lookups: {} })
      claude.state.status = status
      claude.state.message = 'model: claude-haiku-9'
      const ai = new AiClient(config(), claude.fetch)
      const reason = `Anthropic turned the request down (${status}: model: claude-haiku-9). Check AI_MATCH_MODEL and AI_MATCH_EFFORT, and restart.`
      await expect(ai.send(ASK)).rejects.toThrow(reason)
      expect(ai.state()).toEqual({ state: 'failing', error: reason })
      expect([ai.enabled, ai.remaining(), ai.take()]).toEqual([false, 0, false])
      expect(JSON.stringify(ai.state())).not.toContain('test-key')
      claude.state.status = 200
      await expect(ai.send(ASK)).rejects.toBeInstanceOf(AiError)
      expect(claude.state.requests).toHaveLength(1)
    },
  )

  it('is failing while Anthropic answers an error, saying what it said, and ok again after', async () => {
    const claude = fakeClaude({ lookups: {} })
    claude.state.status = 529
    claude.state.message = 'Overloaded'
    const ai = new AiClient(config(), claude.fetch)
    await expect(ai.send(ASK)).rejects.toThrow('Anthropic answered 529: Overloaded.')
    expect(ai.state()).toEqual({ state: 'failing', error: 'Anthropic answered 529: Overloaded.' })
    expect(JSON.stringify(ai.state())).not.toContain('test-key')
    expect(ai.enabled).toBe(true)
    claude.state.status = 200
    await ai.send(ASK)
    expect(ai.state()).toEqual({ state: 'ok', error: null })
  })
})

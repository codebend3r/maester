import { describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'

describe('readServerConfig', () => {
  it('leaves the AI lookup off without a key, on Haiku 5.5 at low effort, 200 a day', () => {
    expect(readServerConfig({})).toMatchObject({
      anthropicApiKey: null,
      aiMatchModel: 'claude-haiku-5-5',
      aiMatchEffort: 'low',
      aiDailyLimit: 200,
    })
  })

  it('reads the key, the model, the effort and the limit', () => {
    expect(
      readServerConfig({
        ANTHROPIC_API_KEY: ' sk-ant-raven ',
        AI_MATCH_MODEL: 'claude-sonnet-5-5',
        AI_MATCH_EFFORT: 'medium',
        AI_DAILY_LIMIT: '50',
      }),
    ).toMatchObject({
      anthropicApiKey: 'sk-ant-raven',
      aiMatchModel: 'claude-sonnet-5-5',
      aiMatchEffort: 'medium',
      aiDailyLimit: 50,
    })
  })

  it('takes an empty key as none, an effort it does not know as low, and at least one lookup a day', () => {
    expect(
      readServerConfig({
        ANTHROPIC_API_KEY: '  ',
        AI_MATCH_EFFORT: 'extreme',
        AI_DAILY_LIMIT: '0',
      }),
    ).toMatchObject({ anthropicApiKey: null, aiMatchEffort: 'low', aiDailyLimit: 1 })
  })

  it('has no media plane until its variables are set', () => {
    expect(readServerConfig({}).mediaPlane).toEqual({
      origins: [],
      webOrigins: [],
      secret: null,
      problems: [],
    })
  })
})

import { describe, expect, it } from 'bun:test'
import { TRUST_MESSAGES, trustDetailFor } from '@/main/servers/serverTrust'
import {
  confirmSignInChangeWith,
  confirmWith,
  signInChangePromptFor,
  trustPromptFor,
} from '@/main/servers/trustPrompt'

const ORIGIN = 'https://raven.example.ts.net'
const LOOKALIKE = 'https://xn--rven-6na.example'

describe('trustPromptFor', () => {
  it('asks about the origin, with Cancel as the default and the escape', () => {
    expect(trustPromptFor({ origin: ORIGIN })).toEqual({
      type: 'question',
      message: TRUST_MESSAGES.prompt(ORIGIN),
      detail: TRUST_MESSAGES.detail,
      buttons: ['Add Server', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    })
  })

  it('spells out a punycode host in its own letters in the detail, keeping the message ASCII', () => {
    const prompt = trustPromptFor({ origin: LOOKALIKE })
    expect(prompt.message).toBe(`Add the raven server at ${LOOKALIKE}?`)
    expect(prompt.detail).toBe(trustDetailFor({ origin: LOOKALIKE }))
    expect(prompt.detail).not.toBe(TRUST_MESSAGES.detail)
  })
})

describe('confirmWith', () => {
  const answering = ({ response }: { response: number }) => {
    const shown: unknown[] = []
    const confirm = confirmWith({
      show: async (prompt) => {
        shown.push(prompt)
        return { response }
      },
    })
    return { confirm, shown }
  }

  it('is a yes only for Add Server', async () => {
    const { confirm, shown } = answering({ response: 0 })
    expect(await confirm(ORIGIN)).toBe(true)
    expect(shown).toEqual([trustPromptFor({ origin: ORIGIN })])
  })

  it('is a no for Cancel, the escape key and anything else', async () => {
    expect(await answering({ response: 1 }).confirm(ORIGIN)).toBe(false)
    expect(await answering({ response: -1 }).confirm(ORIGIN)).toBe(false)
    expect(await answering({ response: 2 }).confirm(ORIGIN)).toBe(false)
  })
})

describe('signInChangePromptFor', () => {
  const NAME = 'Vhagar'
  const HOST = 'project.supabase.co'

  it('asks whether to use the new sign-in host, with Cancel as the default and the escape', () => {
    expect(signInChangePromptFor({ serverName: NAME, host: HOST })).toEqual({
      type: 'question',
      message: 'Vhagar now signs in through project.supabase.co. Use it?',
      detail: TRUST_MESSAGES.signInChangedDetail,
      buttons: ['Use It', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    })
  })

  it('spells out a punycode host in its own letters, keeping the message ASCII', () => {
    const prompt = signInChangePromptFor({ serverName: NAME, host: 'xn--aypal-uye.example' })
    expect(prompt.message).toBe('Vhagar now signs in through xn--aypal-uye.example. Use it?')
    expect(prompt.detail).toBe(
      `${TRUST_MESSAGES.signInChangedDetail} ${TRUST_MESSAGES.lookalike('\u0440aypal.example')}`,
    )
  })
})

describe('confirmSignInChangeWith', () => {
  const answering = ({ response }: { response: number }) => {
    const shown: unknown[] = []
    const confirm = confirmSignInChangeWith({
      show: async (prompt) => {
        shown.push(prompt)
        return { response }
      },
    })
    return { confirm, shown }
  }

  it('is a yes only for Use It', async () => {
    const { confirm, shown } = answering({ response: 0 })
    expect(await confirm({ serverName: 'Vhagar', host: 'a.example' })).toBe(true)
    expect(shown).toEqual([signInChangePromptFor({ serverName: 'Vhagar', host: 'a.example' })])
  })

  it('is a no for Cancel, the escape key and anything else', async () => {
    const input = { serverName: 'Vhagar', host: 'a.example' }
    expect(await answering({ response: 1 }).confirm(input)).toBe(false)
    expect(await answering({ response: -1 }).confirm(input)).toBe(false)
    expect(await answering({ response: 2 }).confirm(input)).toBe(false)
  })
})

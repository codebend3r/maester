import { type DesktopReply, PAGE_ORIGIN, DESKTOP_REPLIES } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { realpath } from 'node:fs/promises'
import { MESSAGES } from '@/main/desktopService'
import { createRequestHandler } from '@/main/requestHandler'
import { isTrustedSender } from '@/main/security'

const ENVELOPE = { kind: 'page', request: { type: 'listRecents' } } as const

const setup = (handle: (envelope: unknown) => Promise<DesktopReply>) => {
  const handled: unknown[] = []
  const warnings: string[] = []
  const handler = createRequestHandler({
    isTrustedSender,
    handle: (envelope) => {
      handled.push(envelope)
      return handle(envelope)
    },
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { handler, handled, warnings }
}

const DONE = { type: 'done' } as const satisfies DesktopReply

describe('createRequestHandler', () => {
  it('refuses a sender off the page origin without calling the service', async () => {
    const { handler, handled, warnings } = setup(async () => DONE)
    expect(await handler({ frameUrl: 'https://evil.example/', payload: ENVELOPE })).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: MESSAGES.unknownRequest,
    })
    expect(handled).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('https://evil.example/')
  })

  it('refuses a frame on the old app://raven origin', async () => {
    const { handler, handled, warnings } = setup(async () => DONE)
    expect(await handler({ frameUrl: 'app://raven/', payload: ENVELOPE })).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: MESSAGES.unknownRequest,
    })
    expect(handled).toEqual([])
    expect(warnings[0]).toContain(PAGE_ORIGIN)
  })

  it('refuses a request with no sender frame', async () => {
    const { handler, handled, warnings } = setup(async () => DONE)
    expect(await handler({ frameUrl: null, payload: ENVELOPE })).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: MESSAGES.unknownRequest,
    })
    expect(handled).toEqual([])
    expect(warnings).toHaveLength(1)
  })

  it('passes the envelope from the page frame to the service unchanged', async () => {
    const { handler, handled, warnings } = setup(async () => DONE)
    expect(await handler({ frameUrl: `${PAGE_ORIGIN}/`, payload: ENVELOPE })).toEqual(DONE)
    expect(handled).toEqual([ENVELOPE])
    expect(warnings).toEqual([])
  })

  it('logs every refusal the service gives', async () => {
    const refusal = { type: 'refused', message: MESSAGES.missing } as const satisfies DesktopReply
    const { handler, warnings } = setup(async () => refusal)
    expect(await handler({ frameUrl: `${PAGE_ORIGIN}/`, payload: ENVELOPE })).toEqual(refusal)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(MESSAGES.missing)
  })

  it('catches a failing service, logs it and refuses', async () => {
    const { handler, warnings } = setup(async () => {
      throw new Error('dialog crashed')
    })
    expect(await handler({ frameUrl: `${PAGE_ORIGIN}/`, payload: ENVELOPE })).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: MESSAGES.unknownRequest,
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('dialog crashed')
  })

  it('keeps the stack of a failing service in the warning', async () => {
    const failure = new Error('dialog crashed')
    failure.stack = 'Error: dialog crashed\n    at showOpenDialog (main.ts:180:5)'
    const { handler, warnings } = setup(async () => {
      throw failure
    })
    await handler({ frameUrl: `${PAGE_ORIGIN}/`, payload: ENVELOPE })
    expect(warnings[0]).toContain('at showOpenDialog (main.ts:180:5)')
  })

  it('names only the call and code of a file system error, never its path or stack', async () => {
    const failure: unknown = await realpath('/Volumes/raven-missing-volume/Secret Film.mkv').then(
      () => null,
      (error: unknown) => error,
    )
    const { handler, warnings } = setup(async () => {
      throw failure
    })
    await handler({ frameUrl: `${PAGE_ORIGIN}/`, payload: ENVELOPE })
    // Node names the call `realpath`, Bun `lstat`.
    expect(warnings).toHaveLength(1)
    expect(warnings[0] ?? '').toMatch(/^raven player failed to answer a request: [a-z]+ ENOENT$/)
  })

  it('falls back to the message of an error without a stack', async () => {
    const failure = new Error('dialog crashed')
    failure.stack = undefined
    const { handler, warnings } = setup(async () => {
      throw failure
    })
    await handler({ frameUrl: `${PAGE_ORIGIN}/`, payload: ENVELOPE })
    expect(warnings[0]).toContain('dialog crashed')
  })
})

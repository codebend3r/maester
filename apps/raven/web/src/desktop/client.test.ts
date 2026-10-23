import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { DESKTOP_EVENTS, DESKTOP_REPLIES, DESKTOP_REQUESTS, type DesktopEvent } from '@raven/core'
import { clientFor } from '@/desktop/client'

const REFUSED = {
  type: DESKTOP_REPLIES.refused,
  message: 'Raven could not read its own reply.',
}

const bridgeOf = ({
  request = async () => ({ type: DESKTOP_REPLIES.done }),
  dropFiles = async () => ({ type: DESKTOP_REPLIES.done }),
}: {
  request?: (request: unknown) => Promise<unknown>
  dropFiles?: (files: readonly unknown[]) => Promise<unknown>
} = {}) => {
  const listeners: ((event: unknown) => void)[] = []
  return {
    request: mock(request),
    dropFiles: mock(dropFiles),
    subscribe: (listener: (event: unknown) => void) => {
      listeners.push(listener)
      return () => undefined
    },
    push: (event: unknown) => listeners.forEach((listener) => listener(event)),
  }
}

describe('clientFor', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => undefined)

  afterEach(() => warn.mockClear())

  it('has no client where there is no bridge, as in a browser', () => {
    expect(clientFor(undefined)).toBeNull()
    expect(clientFor({ request: () => null })).toBeNull()
  })

  it("passes a request on and hands back main's reply once it reads", async () => {
    const bridge = bridgeOf()
    const client = clientFor(bridge)
    expect(await client?.request({ type: DESKTOP_REQUESTS.ready })).toEqual({
      type: DESKTOP_REPLIES.done,
    })
    expect(bridge.request).toHaveBeenCalledWith({ type: DESKTOP_REQUESTS.ready })
  })

  it('turns a reply it cannot read, or a failed request, into a refusal', async () => {
    const odd = clientFor(bridgeOf({ request: async () => ({ type: 'nonsense' }) }))
    expect(await odd?.request({ type: DESKTOP_REQUESTS.ready })).toEqual(REFUSED)
    const broken = clientFor(bridgeOf({ dropFiles: () => Promise.reject(new Error('gone')) }))
    expect(await broken?.dropFiles([])).toEqual(REFUSED)
  })

  it('hands on the events it understands and warns of the rest', () => {
    const bridge = bridgeOf()
    const heard: DesktopEvent[] = []
    clientFor(bridge)?.subscribe((event) => heard.push(event))
    const notice = { type: DESKTOP_EVENTS.notice, message: 'Hello' }
    bridge.push(notice)
    bridge.push({ type: 'unknown' })
    expect(heard).toEqual([notice])
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

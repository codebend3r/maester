import { describe, expect, it, mock, spyOn } from 'bun:test'
import type { RavenDesktopBridge } from '@/shared/bridge'
import { clientFor, isRavenDesktopBridge } from '@/renderer/desktop/client'

const REFUSED = { type: 'refused', message: 'raven player could not read its own reply.' } as const

const bridgeWith = (overrides: Partial<RavenDesktopBridge> = {}): RavenDesktopBridge => ({
  request: async () => ({ type: 'done' }),
  dropFiles: async () => ({ type: 'done' }),
  subscribe: () => () => undefined,
  ...overrides,
})

describe('isRavenDesktopBridge', () => {
  it('wants an object whose three members are functions', () => {
    expect(isRavenDesktopBridge(bridgeWith())).toBe(true)
    expect(isRavenDesktopBridge({ request: 1 })).toBe(false)
    expect(isRavenDesktopBridge(null)).toBe(false)
    expect(isRavenDesktopBridge(undefined)).toBe(false)
    expect(isRavenDesktopBridge({ request() {}, dropFiles() {} })).toBe(false)
  })
})

describe('clientFor', () => {
  it('is null without a bridge', () => {
    expect(clientFor(undefined)).toBeNull()
    expect(clientFor({ request: 1 })).toBeNull()
  })

  it('passes a valid reply through', async () => {
    const client = clientFor(bridgeWith())
    expect(await client?.request({ type: 'listRecents' })).toEqual({ type: 'done' })
  })

  it('turns a reply that fails its guard into the refused reply', async () => {
    const client = clientFor(bridgeWith({ request: async () => ({ type: 'weird' }) }))
    expect(await client?.request({ type: 'listRecents' })).toEqual(REFUSED)
  })

  it('turns a rejected invoke into the refused reply', async () => {
    const client = clientFor(
      bridgeWith({
        request: async () => {
          throw new Error('channel closed')
        },
        dropFiles: async () => {
          throw new Error('channel closed')
        },
      }),
    )
    expect(await client?.request({ type: 'listRecents' })).toEqual(REFUSED)
    expect(await client?.dropFiles([])).toEqual(REFUSED)
  })

  it('forwards the request object unchanged', async () => {
    const request = mock(async (_request: unknown): Promise<unknown> => ({ type: 'done' }))
    const client = clientFor(bridgeWith({ request }))
    const asked = { type: 'listRecents' } as const
    await client?.request(asked)
    expect(request.mock.calls[0]?.[0]).toBe(asked)
  })

  it('checks a drop reply too', async () => {
    const files = [new File(['a'], 'a.mkv')]
    const dropFiles = mock(async (_files: readonly File[]): Promise<unknown> => ({ type: 'x' }))
    const client = clientFor(bridgeWith({ dropFiles }))
    expect(await client?.dropFiles(files)).toEqual(REFUSED)
    expect(dropFiles.mock.calls[0]?.[0]).toBe(files)
  })

  it('delivers a valid event and drops an invalid one with a warning', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    let push: (event: unknown) => void = () => undefined
    const client = clientFor(
      bridgeWith({
        subscribe: (listener) => {
          push = listener
          return () => undefined
        },
      }),
    )
    const heard: unknown[] = []
    client?.subscribe((event) => heard.push(event))
    push({ type: 'notice', message: 'hello' })
    push({ type: 'navigate', to: 'devtools' })
    expect(heard).toEqual([{ type: 'notice', message: 'hello' }])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('returns the bridge unsubscribe', () => {
    const unsubscribe = mock(() => undefined)
    const client = clientFor(bridgeWith({ subscribe: () => unsubscribe }))
    client?.subscribe(() => undefined)()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

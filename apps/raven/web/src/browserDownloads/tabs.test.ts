import { describe, expect, it } from 'bun:test'
import {
  browserTabs,
  INDEX_CHANGED,
  MESSAGE,
  TAB_MESSAGES,
  type TabMessage,
  type TabsWindow,
} from '@/browserDownloads/tabs'

type Locks = NonNullable<TabsWindow['navigator']['locks']>

/** The Web Locks API as far as the tabs use it: one holder a name, the next when it lets go. */
const fakeLocks = (): Locks => {
  const turns = new Map<string, Promise<unknown>>()
  return {
    request: (name, task) => {
      const run = (turns.get(name) ?? Promise.resolve()).then(task)
      turns.set(
        name,
        run.catch(() => undefined),
      )
      return run
    },
  }
}

type Listener = (event: MessageEvent) => void

type DeliverProps = { name: string; from: object | null; data: unknown }

/** Broadcast channels in memory: what one posts reaches every other of its name, never itself. */
const fakeChannels = () => {
  const open: Array<{ name: string; listeners: Listener[] }> = []
  /** Hands `data` to every channel of `name` but `from`, as the browser does. */
  const deliver = ({ name, from, data }: DeliverProps) =>
    open
      .filter((channel) => channel.name === name && channel !== from)
      .forEach(({ listeners }) =>
        listeners.forEach((listener) => listener(new MessageEvent(MESSAGE, { data }))),
      )
  class Channel {
    readonly listeners: Listener[] = []
    constructor(readonly name: string) {
      open.push(this)
    }
    postMessage(message: TabMessage): void {
      deliver({ name: this.name, from: this, data: message })
    }
    addEventListener(_type: string, listener: Listener): void {
      this.listeners.push(listener)
    }
  }
  return { Channel, deliver, names: () => open.map(({ name }) => name) }
}

const RUNNING = {
  kind: TAB_MESSAGES.running,
  running: { downloadId: 'aaaaaaaa-0000-4000-8000-000000000001', bytes: 4, preparing: null },
} as const satisfies TabMessage

describe('browserTabs', () => {
  it('runs the queue and writes as it comes in a browser with no locks and no channel', async () => {
    const tabs = browserTabs({ navigator: {} })
    const held: string[] = []
    tabs.holdQueue(() => held.push('held'))
    expect(held).toEqual(['held'])
    expect(await tabs.withIndex(async () => 'written')).toBe('written')
    tabs.listen(() => held.push('heard'))
    tabs.announce(INDEX_CHANGED)
    expect(held).toEqual(['held'])
  })

  it('gives the queue to the first tab that asks, and keeps it from the next', async () => {
    const locks = fakeLocks()
    const held: string[] = []
    browserTabs({ navigator: { locks } }).holdQueue(() => held.push('first'))
    browserTabs({ navigator: { locks } }).holdQueue(() => held.push('second'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(held).toEqual(['first'])
  })

  it('lets one tab at a time into the index, and passes on what its task came to', async () => {
    const locks = fakeLocks()
    const first = browserTabs({ navigator: { locks } })
    const second = browserTabs({ navigator: { locks } })
    const order: string[] = []
    const slow = first.withIndex(async () => {
      order.push('first in')
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('first out')
      return 1
    })
    const next = second.withIndex(async () => {
      order.push('second in')
      return 2
    })
    expect(await Promise.all([slow, next])).toEqual([1, 2])
    expect(order).toEqual(['first in', 'first out', 'second in'])
    await expect(
      first.withIndex(async () => {
        throw new Error('no room')
      }),
    ).rejects.toThrow('no room')
  })

  it('tells the other tabs, and hears only what a tab would say', () => {
    const channels = fakeChannels()
    const target = { navigator: {}, BroadcastChannel: channels.Channel }
    const first = browserTabs(target)
    const second = browserTabs(target)
    const heard: TabMessage[] = []
    second.listen((message) => heard.push(message))
    first.announce(INDEX_CHANGED)
    first.announce(RUNNING)
    const [name = ''] = channels.names()
    channels.deliver({ name, from: null, data: { kind: 'other' } })
    channels.deliver({ name, from: null, data: { kind: TAB_MESSAGES.running, running: 4 } })
    expect(heard).toEqual([INDEX_CHANGED, RUNNING])
  })
})

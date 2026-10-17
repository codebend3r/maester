import { expect, type Page } from '@playwright/test'
import {
  type Infer,
  isNumber,
  isPlayerEvent,
  isPlayerReply,
  isPlayerRequest,
  isRecord,
  type PlayerEvent,
} from '@raven/core'
import { PLAYER_PORT_MESSAGE } from '@/shared/protocol'

const TAP_KEY = 'ravenE2ePlayerTap'
const PORT_KEY = 'ravenE2ePlayerPort'

type Keys = { tapKey: string; portKey: string; portMessage: string }

/**
 * Runs in the page before its own scripts, so it sees the player port the preload hands
 * over and every message on it both ways, without changing what the page does with them.
 * Serialized into the page, so it names nothing outside itself.
 */
const installTap = ({ tapKey, portKey, portMessage }: Keys) => {
  const record = { ports: 0, sent: new Array<unknown>(), received: new Array<unknown>() }
  Reflect.set(window, tapKey, record)
  window.addEventListener('message', (event) => {
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null || !('type' in data)) return
    if (data.type !== portMessage) return
    const [port] = event.ports
    if (port === undefined) return
    record.ports += 1
    Reflect.set(window, portKey, port)
    port.addEventListener('message', (message) => {
      const received: unknown = message.data
      record.received.push(received)
    })
  })
  const post = MessagePort.prototype.postMessage
  Reflect.set(
    MessagePort.prototype,
    'postMessage',
    function tapped(this: MessagePort, ...args: unknown[]) {
      record.sent.push(args[0])
      Reflect.apply(post, this, args)
    },
  )
}

type PlayerRequest = Infer<typeof isPlayerRequest>
type PlayerReply = Infer<typeof isPlayerReply>

/** What crossed the player port in this page load, each side narrowed by the protocol's guards. */
export type PlayerTraffic = {
  ports: number
  requests: PlayerRequest[]
  replies: PlayerReply[]
  events: PlayerEvent[]
  /** Whatever came back that is neither a reply nor an event. */
  strays: unknown[]
}

const NO_TRAFFIC: PlayerTraffic = { ports: 0, requests: [], replies: [], events: [], strays: [] }

const listed = (value: unknown): unknown[] => (Array.isArray(value) ? [...value] : [])

/**
 * Taps the player port: installs the tap for every page load from now on, then reloads,
 * which hands the new page a fresh port (Ruling 12), and waits for the tap to hold it.
 */
export const tapPlayerPort = async ({ page }: { page: Page }): Promise<void> => {
  await page.context().addInitScript(installTap, {
    tapKey: TAP_KEY,
    portKey: PORT_KEY,
    portMessage: PLAYER_PORT_MESSAGE,
  })
  await page.reload()
  await expect.poll(async () => (await trafficOf({ page })).ports).toBe(1)
}

export const trafficOf = async ({ page }: { page: Page }): Promise<PlayerTraffic> => {
  const record = await page.evaluate((key) => {
    const found: unknown = Reflect.get(window, key)
    return found ?? null
  }, TAP_KEY)
  if (!isRecord(record) || !isNumber(record.ports)) return NO_TRAFFIC
  const received = listed(record.received)
  return {
    ports: record.ports,
    requests: listed(record.sent).filter(isPlayerRequest),
    replies: received.filter(isPlayerReply),
    events: received.filter(isPlayerEvent),
    strays: received.filter((data) => !isPlayerReply(data) && !isPlayerEvent(data)),
  }
}

/** Posts `messages` on the page's player port as they are, in order, the way a page could. */
export const postOnPort = async ({ page, messages }: { page: Page; messages: unknown[] }) => {
  await page.evaluate(
    ({ key, sent }) => {
      const port: unknown = Reflect.get(window, key)
      if (!(port instanceof MessagePort)) throw new Error('The page holds no player port.')
      sent.forEach((message) => port.postMessage(message))
    },
    { key: PORT_KEY, sent: messages },
  )
}

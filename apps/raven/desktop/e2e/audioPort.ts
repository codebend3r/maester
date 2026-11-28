import { expect, type Page } from '@playwright/test'
import {
  AUDIO_EVENTS,
  type AudioEvent,
  isAudioEvent,
  isNumber,
  isRecord,
  WINDOW_MESSAGE_TYPES,
} from '@raven/core'

const TAP_KEY = 'ravenE2eAudioTap'

/** The event a window and a port hand their messages over as. */
const MESSAGE_EVENT = 'message' as const

type Keys = { tapKey: string; portMessage: string; messageEvent: typeof MESSAGE_EVENT }

/**
 * Runs in the page before its own scripts and records every message main's music engine sends
 * on the audio port, without changing what the page does with them. Serialized into the page,
 * so it names nothing outside itself.
 */
const installTap = ({ tapKey, portMessage, messageEvent }: Keys) => {
  const record = { ports: 0, received: new Array<unknown>() }
  Reflect.set(window, tapKey, record)
  window.addEventListener(messageEvent, (event) => {
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null || !('type' in data)) return
    if (data.type !== portMessage) return
    const [port] = event.ports
    if (port === undefined) return
    record.ports += 1
    port.addEventListener(messageEvent, (message) => {
      const received: unknown = message.data
      record.received.push(received)
    })
  })
}

type TapAudioPortProps = { page: Page }

/**
 * Taps the audio port: installs the tap for every page load from now on, then reloads, which
 * hands the new page a fresh port, and waits for the tap to hold it.
 */
export const tapAudioPort = async ({ page }: TapAudioPortProps): Promise<void> => {
  await page.context().addInitScript(installTap, {
    tapKey: TAP_KEY,
    portMessage: WINDOW_MESSAGE_TYPES.audioPort,
    messageEvent: MESSAGE_EVENT,
  })
  await page.reload()
  await expect.poll(async () => (await audioEventsOf({ page })).ports).toBe(1)
}

type AudioTraffic = { ports: number; events: AudioEvent[] }

const NO_TRAFFIC: AudioTraffic = { ports: 0, events: [] }

type AudioEventsOfProps = { page: Page }

/** What main's music engine sent on the audio port in this page load, narrowed by the protocol's guard. */
const audioEventsOf = async ({ page }: AudioEventsOfProps): Promise<AudioTraffic> => {
  const record = await page.evaluate((key) => {
    const found: unknown = Reflect.get(window, key)
    return found ?? null
  }, TAP_KEY)
  if (!isRecord(record) || !isNumber(record.ports) || !Array.isArray(record.received)) {
    return NO_TRAFFIC
  }
  return { ports: record.ports, events: record.received.filter(isAudioEvent) }
}

type LevelsOfProps = { page: Page }

/** The RMS level of each `levels` event main has sent so far, in order. */
export const levelsOf = async ({ page }: LevelsOfProps): Promise<number[]> => {
  const { events } = await audioEventsOf({ page })
  return events.flatMap((event) => (event.type === AUDIO_EVENTS.levels ? [event.measure.rms] : []))
}

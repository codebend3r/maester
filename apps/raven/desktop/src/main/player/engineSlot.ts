import { ENGINE_MESSAGES, type OpenedEngine } from '@/main/player/engine'
import type { PlayerService } from '@/main/player/playerService'
import { messageOf } from '@/shared/messageOf'

const STATES = [
  'idle',
  'opening',
  'native',
  'dead',
  'unavailable',
  'destroying',
  'destroyed',
] as const
type SlotState = (typeof STATES)[number]

const UNAVAILABLE = {
  status: 'unavailable',
  message: ENGINE_MESSAGES.unavailable,
} as const satisfies OpenedEngine<never>

/**
 * Tells `onDied` when the service's mpv stops for good, including a stop that came before
 * this was asked to watch.
 */
export const watchService = ({
  engine,
  onDied,
}: {
  engine: { service: Pick<PlayerService, 'subscribe' | 'isDead'> }
  onDied: () => void
}): void => {
  engine.service.subscribe((event) => {
    if (event.type === 'error' && event.reason === 'engine') onDied()
  })
  if (engine.service.isDead()) onDied()
}

/**
 * A window's one engine: opened on first ask and never again (the addon refuses a second
 * surface on a window), destroyed once. It counts as alive while it opens, after it died
 * and until its destroy settles, so a close or quit in that time still waits for mpv to
 * stop. Once `watch` reports it died, a page that asks is told to use the html engine.
 */
export const createEngineSlot = <T>({
  open,
  destroyOf,
  watch,
  warn,
}: {
  open: () => Promise<OpenedEngine<T>>
  destroyOf: (engine: T) => Promise<void>
  watch: (input: { engine: T; onDied: () => void }) => void
  warn: (message: string) => void
}) => {
  let state: SlotState = 'idle'
  let engine: T | null = null
  let opened: Promise<OpenedEngine<T>> | null = null
  let handed: Promise<OpenedEngine<T>> | null = null
  let destruction: Promise<void> | null = null
  // A function, so a check after `watch` reads the state as it is then.
  const isDead = () => state === 'dead'

  const died = () => {
    if (state !== 'native') return
    state = 'dead'
    engine = null
  }

  const begin = () => {
    state = 'opening'
    // Deferred, so the pending open is on record before any of it runs: a quit can arrive
    // inside it (the inspector runs at interrupts), and must find something to stop.
    const raw = Promise.resolve()
      .then(() => (state === 'opening' ? open() : UNAVAILABLE))
      .catch((error: unknown): OpenedEngine<T> => {
        warn(`raven player could not open its video engine: ${messageOf(error)}`)
        return UNAVAILABLE
      })
    opened = raw
    return raw.then((result): OpenedEngine<T> => {
      // A destroy asked for while it opened owns what it opened.
      if (state !== 'opening') return UNAVAILABLE
      state = result.status
      if (result.status !== 'native') return result
      engine = result.engine
      try {
        watch({ engine: result.engine, onDied: died })
      } catch (error) {
        warn(`raven player could not watch its video engine: ${messageOf(error)}`)
      }
      return isDead() ? UNAVAILABLE : result
    })
  }

  const get = (): Promise<OpenedEngine<T>> => {
    if (state === 'dead' || state === 'destroying' || state === 'destroyed') {
      return Promise.resolve(UNAVAILABLE)
    }
    handed ??= begin()
    return handed
  }

  const stop = async (pending: Promise<OpenedEngine<T>> | null) => {
    try {
      if (pending === null) return
      const result = await pending
      if (result.status === 'native') await destroyOf(result.engine)
    } finally {
      state = 'destroyed'
    }
  }

  const destroy = (): Promise<void> => {
    if (destruction !== null) return destruction
    engine = null
    state = state === 'idle' || state === 'unavailable' ? 'destroyed' : 'destroying'
    destruction = state === 'destroyed' ? Promise.resolve() : stop(opened)
    return destruction
  }

  return {
    get,
    /** The open engine, or null while it opens, when it could not open, once it died and once it is destroyed. */
    current: (): T | null => engine,
    isAlive: () =>
      state === 'opening' || state === 'native' || state === 'dead' || state === 'destroying',
    destroy,
  }
}

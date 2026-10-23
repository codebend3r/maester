import { describe, expect, mock, test } from 'bun:test'
import type { PlayerEvent } from '@raven/core'
import { ENGINE_MESSAGES, type OpenedEngine } from '@/main/player/engine'
import { createEngineSlot, watchService } from '@/main/player/engineSlot'

type Engine = { name: string }

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const setup = ({
  opened = { status: 'native', engine: { name: 'mpv' } },
  destroy = async () => {},
}: {
  opened?: OpenedEngine<Engine> | Promise<OpenedEngine<Engine>>
  destroy?: () => Promise<void>
} = {}) => {
  const log: string[] = []
  const warn = mock((_message: string) => {})
  const watched: { onDied: () => void } = { onDied: () => {} }
  const slot = createEngineSlot<Engine>({
    open: async () => {
      log.push('open')
      return opened
    },
    destroyOf: async (engine) => {
      log.push(`destroy ${engine.name}`)
      await destroy()
    },
    watch: ({ engine, onDied }) => {
      log.push(`watch ${engine.name}`)
      watched.onDied = onDied
    },
    warn,
  })
  return { slot, log, warn, die: () => watched.onDied() }
}

describe('createEngineSlot', () => {
  test('opens nothing until asked, then opens once however often it is asked', async () => {
    const { slot, log } = setup()
    expect(log).toEqual([])
    expect(slot.isAlive()).toBe(false)
    expect(slot.current()).toBeNull()
    const [first, second] = await Promise.all([slot.get(), slot.get()])
    expect(first).toEqual({ status: 'native', engine: { name: 'mpv' } })
    expect(second).toBe(first)
    expect(log).toEqual(['open', 'watch mpv'])
    expect(slot.current()).toEqual({ name: 'mpv' })
    expect(slot.isAlive()).toBe(true)
  })

  test('is alive while it opens', () => {
    const { slot } = setup({ opened: new Promise(() => undefined) })
    slot.get().catch(() => undefined)
    expect(slot.isAlive()).toBe(true)
    expect(slot.current()).toBeNull()
  })

  test('an unavailable engine is not alive and holds nothing', async () => {
    const { slot } = setup({ opened: { status: 'unavailable', message: ENGINE_MESSAGES.off } })
    expect(await slot.get()).toEqual({ status: 'unavailable', message: ENGINE_MESSAGES.off })
    expect(slot.isAlive()).toBe(false)
    expect(slot.current()).toBeNull()
  })

  test('an open that throws is unavailable and warned', async () => {
    const { slot, warn } = setup({ opened: Promise.reject(new Error('no addon')) })
    expect(await slot.get()).toEqual({
      status: 'unavailable',
      message: ENGINE_MESSAGES.unavailable,
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(slot.isAlive()).toBe(false)
  })

  test('destroy stops the open engine once and it stays alive until that settles', async () => {
    const stopped = Promise.withResolvers<void>()
    const { slot, log } = setup({ destroy: () => stopped.promise })
    await slot.get()
    const first = slot.destroy()
    const second = slot.destroy()
    await settle()
    expect(slot.isAlive()).toBe(true)
    expect(slot.current()).toBeNull()
    stopped.resolve()
    await Promise.all([first, second])
    expect(log).toEqual(['open', 'watch mpv', 'destroy mpv'])
    expect(slot.isAlive()).toBe(false)
    // A page that asks after the engine is gone gets the html engine, never a dead one.
    expect(await slot.get()).toEqual({
      status: 'unavailable',
      message: ENGINE_MESSAGES.unavailable,
    })
  })

  test('a destroy that rejects still leaves the engine dead and rejects to its caller', async () => {
    const { slot } = setup({ destroy: () => Promise.reject(new Error('terminate failed')) })
    await slot.get()
    await expect(slot.destroy()).rejects.toThrow('terminate failed')
    expect(slot.isAlive()).toBe(false)
  })

  test('a destroy while it opens waits for the open and stops what it opened', async () => {
    const opening = Promise.withResolvers<OpenedEngine<Engine>>()
    const { slot, log } = setup({ opened: opening.promise })
    const got = slot.get()
    await settle()
    const destroying = slot.destroy()
    expect(slot.isAlive()).toBe(true)
    opening.resolve({ status: 'native', engine: { name: 'late' } })
    await destroying
    expect(log).toEqual(['open', 'destroy late'])
    expect(slot.isAlive()).toBe(false)
    expect(slot.current()).toBeNull()
    expect(await got).toEqual({ status: 'unavailable', message: ENGINE_MESSAGES.unavailable })
  })

  test('destroy before any open opens nothing, and a later ask is unavailable', async () => {
    const { slot, log } = setup()
    await slot.destroy()
    expect(await slot.get()).toEqual({
      status: 'unavailable',
      message: ENGINE_MESSAGES.unavailable,
    })
    expect(log).toEqual([])
    expect(slot.isAlive()).toBe(false)
  })

  test('a destroy that lands while the open is still running synchronously stops what it opens', async () => {
    const log: string[] = []
    const holder: { slot: ReturnType<typeof createEngineSlot<Engine>> | null } = { slot: null }
    const destroying: Promise<void>[] = []
    const slot = createEngineSlot<Engine>({
      open: async () => {
        // The inspector runs a quit at an interrupt, inside JavaScript that is still running.
        if (holder.slot !== null) destroying.push(holder.slot.destroy())
        log.push('open')
        return { status: 'native', engine: { name: 'mpv' } }
      },
      destroyOf: async (engine) => {
        log.push(`destroy ${engine.name}`)
      },
      watch: () => {},
      warn: () => {},
    })
    holder.slot = slot
    const got = slot.get()
    expect(await got).toEqual({ status: 'unavailable', message: ENGINE_MESSAGES.unavailable })
    expect(destroying).toHaveLength(1)
    await Promise.all(destroying)
    expect(log).toEqual(['open', 'destroy mpv'])
    expect(slot.isAlive()).toBe(false)
  })

  test('a destroy before the deferred open starts opens nothing', async () => {
    const { slot, log } = setup()
    const got = slot.get()
    await slot.destroy()
    expect(await got).toEqual({ status: 'unavailable', message: ENGINE_MESSAGES.unavailable })
    expect(log).toEqual([])
  })

  test('once the engine died a page is told to use the html engine, and quitting still destroys it', async () => {
    const { slot, log, die } = setup()
    await slot.get()
    die()
    expect(await slot.get()).toEqual({
      status: 'unavailable',
      message: ENGINE_MESSAGES.unavailable,
    })
    expect(slot.current()).toBeNull()
    expect(slot.isAlive()).toBe(true)
    await slot.destroy()
    expect(log).toEqual(['open', 'watch mpv', 'destroy mpv'])
    expect(slot.isAlive()).toBe(false)
  })

  test('an engine that died before its open was handed over is unavailable from the first ask', async () => {
    const log: string[] = []
    const slot = createEngineSlot<Engine>({
      open: async () => ({ status: 'native', engine: { name: 'mpv' } }),
      destroyOf: async (engine) => {
        log.push(`destroy ${engine.name}`)
      },
      watch: ({ onDied }) => onDied(),
      warn: () => {},
    })
    expect(await slot.get()).toEqual({
      status: 'unavailable',
      message: ENGINE_MESSAGES.unavailable,
    })
    await slot.destroy()
    expect(log).toEqual(['destroy mpv'])
  })

  test('a death reported after destroy began changes nothing', async () => {
    const { slot, log, die } = setup()
    await slot.get()
    const destroying = slot.destroy()
    die()
    await destroying
    expect(log).toEqual(['open', 'watch mpv', 'destroy mpv'])
    expect(slot.isAlive()).toBe(false)
  })

  test('a watch that throws is warned and the engine is still handed over', async () => {
    const warn = mock((_message: string) => {})
    const slot = createEngineSlot<Engine>({
      open: async () => ({ status: 'native', engine: { name: 'mpv' } }),
      destroyOf: async () => {},
      watch: () => {
        throw new Error('no listeners')
      },
      warn,
    })
    expect(await slot.get()).toEqual({ status: 'native', engine: { name: 'mpv' } })
    expect(warn).toHaveBeenCalledWith('Raven could not watch its video engine: no listeners')
  })
})

describe('watchService', () => {
  const serviceWith = ({ isDead = false }: { isDead?: boolean } = {}) => {
    const listeners: ((event: PlayerEvent) => void)[] = []
    return {
      service: {
        subscribe: (listener: (event: PlayerEvent) => void) => {
          listeners.push(listener)
          return () => {}
        },
        isDead: () => isDead,
      },
      emit: (event: PlayerEvent) => listeners.forEach((listener) => listener(event)),
    }
  }

  test('an engine error is a death; a decode error or an open error is not', () => {
    const onDied = mock(() => {})
    const { service, emit } = serviceWith()
    watchService({ engine: { service }, onDied })
    emit({ type: 'error', reason: 'decode', message: 'Bad frame' })
    emit({ type: 'error', reason: 'open', message: 'No file' })
    emit({ type: 'ended' })
    expect(onDied).not.toHaveBeenCalled()
    emit({ type: 'error', reason: 'engine', message: 'Stopped' })
    expect(onDied).toHaveBeenCalledTimes(1)
  })

  test('a service already dead reports at once', () => {
    const onDied = mock(() => {})
    watchService({ engine: serviceWith({ isDead: true }), onDied })
    expect(onDied).toHaveBeenCalledTimes(1)
  })
})

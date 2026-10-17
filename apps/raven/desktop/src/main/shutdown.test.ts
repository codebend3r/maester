import { describe, expect, mock, test } from 'bun:test'
import { createQuitGate } from '@/main/quitGate'
import {
  closeTimeoutFor,
  createShutdown,
  DESTROY_MS,
  hardExitFor,
  QUIT_FLUSH_MS,
} from '@/main/shutdown'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const never = () => new Promise<void>(() => undefined)

/** A shutdown whose destroy deadline never passes unless the test says so. */
const shutdownOf = (input: Omit<Parameters<typeof createShutdown>[0], 'wait'>) =>
  createShutdown({ wait: never, ...input })

const fakeEngine = ({
  log,
  destroy = async () => {},
}: {
  log: string[]
  destroy?: () => Promise<void>
}) => {
  const state = { isAlive: true, destroys: 0 }
  return {
    state,
    engine: {
      isAlive: () => state.isAlive,
      // Alive until the destroy settles, so a second close while mpv stops is held too.
      destroy: async () => {
        log.push('destroy')
        state.destroys += 1
        try {
          await destroy()
        } finally {
          state.isAlive = false
        }
      },
    },
  }
}

const fakeStore = ({ log, name, isDirty }: { log: string[]; name: string; isDirty: boolean }) => {
  const state = { isDirty }
  return {
    state,
    store: {
      isDirty: () => state.isDirty,
      flush: async () => {
        log.push(`flush ${name}`)
        state.isDirty = false
      },
    },
  }
}

describe('createShutdown', () => {
  test('is pending while the engine is alive, even with clean stores', () => {
    const log: string[] = []
    const { engine } = fakeEngine({ log })
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: false }).store],
      warn: () => {},
    })
    expect(shutdown.isPending()).toBe(true)
  })

  test('is pending while a store is dirty, even with the engine gone', () => {
    const log: string[] = []
    const { engine, state } = fakeEngine({ log })
    state.isAlive = false
    const shutdown = shutdownOf({
      engine,
      stores: [
        fakeStore({ log, name: 'state', isDirty: false }).store,
        fakeStore({ log, name: 'config', isDirty: true }).store,
      ],
      warn: () => {},
    })
    expect(shutdown.isPending()).toBe(true)
  })

  test('is not pending with the engine gone and every store clean', () => {
    const log: string[] = []
    const { engine, state } = fakeEngine({ log })
    state.isAlive = false
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: false }).store],
      warn: () => {},
    })
    expect(shutdown.isPending()).toBe(false)
  })

  test('settle destroys the engine before it flushes any store', async () => {
    const log: string[] = []
    const { engine } = fakeEngine({ log })
    const shutdown = shutdownOf({
      engine,
      stores: [
        fakeStore({ log, name: 'state', isDirty: true }).store,
        fakeStore({ log, name: 'config', isDirty: true }).store,
      ],
      warn: () => {},
    })
    await shutdown.settle()
    expect(log[0]).toBe('destroy')
    expect(log.slice(1).toSorted()).toEqual(['flush config', 'flush state'])
    expect(shutdown.isPending()).toBe(false)
  })

  test('the stores wait for a slow destroy', async () => {
    const log: string[] = []
    const destroyed = Promise.withResolvers<void>()
    const { engine } = fakeEngine({ log, destroy: () => destroyed.promise })
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: true }).store],
      warn: () => {},
    })
    const settling = shutdown.settle()
    await settle()
    expect(log).toEqual(['destroy'])
    destroyed.resolve()
    await settling
    expect(log).toEqual(['destroy', 'flush state'])
  })

  test('a destroy that rejects is warned and the stores still flush', async () => {
    const log: string[] = []
    const warn = mock((_message: string) => {})
    const { engine } = fakeEngine({
      log,
      destroy: () => Promise.reject(new Error('terminate failed')),
    })
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: true }).store],
      warn,
    })
    await shutdown.settle()
    expect(log).toEqual(['destroy', 'flush state'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0] ?? '').toContain('terminate failed')
  })

  test('a dead engine is not destroyed again', async () => {
    const log: string[] = []
    const { engine, state } = fakeEngine({ log })
    state.isAlive = false
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: true }).store],
      warn: () => {},
    })
    await shutdown.settle()
    expect(log).toEqual(['flush state'])
  })
})

describe('a destroy that never settles', () => {
  test('is given DESTROY_MS, warned, and the stores flush anyway', async () => {
    const log: string[] = []
    const warn = mock((_message: string) => {})
    const deadline = Promise.withResolvers<void>()
    const waits: number[] = []
    const { engine } = fakeEngine({ log, destroy: never })
    const shutdown = createShutdown({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: true }).store],
      warn,
      wait: (ms) => {
        waits.push(ms)
        return deadline.promise
      },
    })
    const settling = shutdown.settle()
    await settle()
    expect(log).toEqual(['destroy'])
    expect(waits).toEqual([DESTROY_MS])
    deadline.resolve()
    await settling
    expect(log).toEqual(['destroy', 'flush state'])
    expect(warn).toHaveBeenCalledTimes(1)
    // mpv is still stopping, so the quit gate gives up on it and exits hard.
    expect(shutdown.isPending()).toBe(true)
  })

  test('leaves room in the quit gate for the stores to write', () => {
    expect(DESTROY_MS).toBeLessThan(QUIT_FLUSH_MS)
  })

  test('after one timeout, a later settle flushes without waiting on mpv again', async () => {
    const log: string[] = []
    const waits: number[] = []
    const deadline = Promise.withResolvers<void>()
    const { engine, state } = fakeEngine({ log, destroy: never })
    const store = fakeStore({ log, name: 'state', isDirty: true })
    const shutdown = createShutdown({
      engine,
      stores: [store.store],
      warn: () => {},
      wait: (ms) => {
        waits.push(ms)
        return deadline.promise
      },
    })
    const first = shutdown.settle()
    deadline.resolve()
    await first
    // A save that lands between the quit gate's two attempts.
    store.state.isDirty = true
    await shutdown.settle()
    expect(waits).toEqual([DESTROY_MS])
    expect(state.destroys).toBe(1)
    expect(log).toEqual(['destroy', 'flush state', 'flush state'])
  })
})

describe('hardExitFor', () => {
  test('kills the process while mpv is alive, since teardown would wait on it forever', () => {
    expect(hardExitFor({ isEngineAlive: true })).toBe('kill')
  })

  test('exits normally once mpv is gone', () => {
    expect(hardExitFor({ isEngineAlive: false })).toBe('exit')
  })
})

describe('closeTimeoutFor', () => {
  test('a window close that timed out on a live mpv quits the app, so the stores flush', () => {
    expect(closeTimeoutFor({ isEngineAlive: true })).toBe('quitApp')
  })

  test('a window close that timed out after mpv died destroys the window', () => {
    expect(closeTimeoutFor({ isEngineAlive: false })).toBe('destroyWindow')
  })
})

describe('the window close gate over the engine', () => {
  test('a close while the engine is alive is held, destroys once, then closes', async () => {
    const log: string[] = []
    const { engine, state } = fakeEngine({ log })
    const calls = { prevented: 0, close: 0, destroyWindow: 0 }
    const gate = createQuitGate({
      isDirty: engine.isAlive,
      flush: engine.destroy,
      timeoutMs: 1000,
      quit: () => {
        log.push('window.close')
        calls.close += 1
      },
      exit: () => {
        calls.destroyWindow += 1
      },
      wait: () => new Promise<void>(() => undefined),
    })
    const event = {
      preventDefault: () => {
        calls.prevented += 1
      },
    }
    gate(event)
    gate(event)
    await settle()
    expect(calls).toEqual({ prevented: 2, close: 1, destroyWindow: 0 })
    expect(state.destroys).toBe(1)
    expect(log).toEqual(['destroy', 'window.close'])
    // The close the gate sends itself passes straight through.
    gate(event)
    expect(calls.prevented).toBe(2)
  })

  test('the app quit gate destroys the engine before the stores and then quits', async () => {
    const log: string[] = []
    const { engine } = fakeEngine({ log })
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: false }).store],
      warn: () => {},
    })
    const gate = createQuitGate({
      isDirty: shutdown.isPending,
      flush: shutdown.settle,
      timeoutMs: 1000,
      quit: () => log.push('quit'),
      exit: () => log.push('exit'),
      wait: () => new Promise<void>(() => undefined),
    })
    gate({ preventDefault: () => log.push('prevented') })
    await settle()
    expect(log).toEqual(['prevented', 'destroy', 'flush state', 'quit'])
  })
})

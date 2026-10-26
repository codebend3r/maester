import { describe, expect, mock, test } from 'bun:test'
import { createQuitGate } from '@/main/quitGate'
import {
  CLOSE_TIMEOUTS,
  closeTimeoutFor,
  createShutdown,
  DESTROY_MS,
  endAfterLog,
  HARD_EXITS,
  hardExitFor,
  LOG_FLUSH_MS,
  QUIT_FLUSH_MS,
} from '@/main/shutdown'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const never = () => new Promise<void>(() => undefined)

type ShutdownDeps = Parameters<typeof createShutdown>[0]

const noWrites: ShutdownDeps['writes'] = { hasPending: () => false, settle: async () => {} }

const cleanLog: ShutdownDeps['log'] = { isDirty: () => false, flush: async () => {} }

/**
 * A shutdown whose deadlines never pass unless the test says so, with no saves in flight
 * and nothing left to log unless given.
 */
const shutdownOf = (
  input: Omit<ShutdownDeps, 'wait' | 'writes' | 'log'> & {
    writes?: ShutdownDeps['writes']
    log?: ShutdownDeps['log']
  },
) => createShutdown({ wait: never, writes: noWrites, log: cleanLog, ...input })

type FakeEngineProps = {
  log: string[]
  destroy?: () => Promise<void>
}

const fakeEngine = ({ log, destroy = async () => {} }: FakeEngineProps) => {
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

type FakeStoreProps = { log: string[]; name: string; isDirty: boolean }

const fakeStore = ({ log, name, isDirty }: FakeStoreProps) => {
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
      writes: noWrites,
      log: cleanLog,
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
      writes: noWrites,
      log: cleanLog,
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

type FakeWritesProps = { log: string[] }

/** Saves in flight to a server: pending until `finish` settles them. */
const fakeWrites = ({ log }: FakeWritesProps) => {
  const done = Promise.withResolvers<void>()
  const state = { isPending: true }
  return {
    finish: () => {
      state.isPending = false
      done.resolve()
    },
    writes: {
      hasPending: () => state.isPending,
      settle: async () => {
        log.push('writes')
        await done.promise
        log.push('writes settled')
      },
    },
  }
}

describe('saves in flight', () => {
  test('keep the quit pending with the engine gone and every store clean', () => {
    const log: string[] = []
    const { engine, state } = fakeEngine({ log })
    state.isAlive = false
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: false }).store],
      writes: fakeWrites({ log }).writes,
      warn: () => {},
    })
    expect(shutdown.isPending()).toBe(true)
  })

  test('nothing in flight leaves nothing pending', () => {
    const log: string[] = []
    const { engine, state } = fakeEngine({ log })
    state.isAlive = false
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: false }).store],
      writes: noWrites,
      log: cleanLog,
      warn: () => {},
    })
    expect(shutdown.isPending()).toBe(false)
  })

  test('settle waits for them before any store flushes, while the engine stops alongside', async () => {
    const log: string[] = []
    const destroyed = Promise.withResolvers<void>()
    const { engine } = fakeEngine({ log, destroy: () => destroyed.promise })
    const saves = fakeWrites({ log })
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: true }).store],
      writes: saves.writes,
      warn: () => {},
    })
    const settling = shutdown.settle()
    await settle()
    expect(log.toSorted()).toEqual(['destroy', 'writes'])
    destroyed.resolve()
    await settle()
    expect(log).not.toContain('flush state')
    saves.finish()
    await settling
    expect(log.slice(-2)).toEqual(['writes settled', 'flush state'])
    expect(shutdown.isPending()).toBe(false)
  })

  test('a save that never settles is given DESTROY_MS, warned, and the stores flush anyway', async () => {
    const log: string[] = []
    const warn = mock((_message: string) => {})
    const deadline = Promise.withResolvers<void>()
    const waits: number[] = []
    const { engine, state } = fakeEngine({ log })
    state.isAlive = false
    const shutdown = createShutdown({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: true }).store],
      writes: fakeWrites({ log }).writes,
      log: cleanLog,
      warn,
      wait: (ms) => {
        waits.push(ms)
        return deadline.promise
      },
    })
    const settling = shutdown.settle()
    await settle()
    expect(log).toEqual(['writes'])
    expect(waits).toEqual([DESTROY_MS])
    deadline.resolve()
    await settling
    expect(log).toEqual(['writes', 'flush state'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0] ?? '').toContain('saves')
    // Given up on, so they no longer hold the quit, and a later settle does not wait again.
    expect(shutdown.isPending()).toBe(false)
    await shutdown.settle()
    expect(waits).toEqual([DESTROY_MS])
  })

  test('a settle with nothing in flight waits on no deadline for them', async () => {
    const log: string[] = []
    const waits: number[] = []
    const { engine, state } = fakeEngine({ log })
    state.isAlive = false
    const shutdown = createShutdown({
      engine,
      stores: [fakeStore({ log, name: 'state', isDirty: true }).store],
      writes: noWrites,
      log: cleanLog,
      warn: () => {},
      wait: (ms) => {
        waits.push(ms)
        return never()
      },
    })
    await shutdown.settle()
    expect(waits).toEqual([])
    expect(log).toEqual(['flush state'])
  })
})

type FakeLogProps = { log: string[]; isHeld?: boolean }

/** The log: dirty until a flush that `finish` settles, or at once when given no hold. */
const fakeLog = ({ log, isHeld = false }: FakeLogProps) => {
  const done = Promise.withResolvers<void>()
  const state = { isDirty: true }
  return {
    state,
    finish: () => {
      state.isDirty = false
      done.resolve()
    },
    log: {
      isDirty: () => state.isDirty,
      flush: async () => {
        log.push('flush log')
        if (isHeld) {
          await done.promise
          return
        }
        state.isDirty = false
      },
    },
  }
}

describe('the log', () => {
  test('keeps the quit pending while it has lines to write', () => {
    const order: string[] = []
    const { engine, state } = fakeEngine({ log: order })
    state.isAlive = false
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log: order, name: 'state', isDirty: false }).store],
      log: fakeLog({ log: order }).log,
      warn: () => {},
    })
    expect(shutdown.isPending()).toBe(true)
  })

  test('flushes last, after mpv stopped and every store wrote, so their failures reach it', async () => {
    const order: string[] = []
    const { engine } = fakeEngine({ log: order })
    const written = fakeLog({ log: order })
    const shutdown = shutdownOf({
      engine,
      stores: [fakeStore({ log: order, name: 'state', isDirty: true }).store],
      log: written.log,
      warn: () => {},
    })
    await shutdown.settle()
    expect(order).toEqual(['destroy', 'flush state', 'flush log'])
    expect(shutdown.isPending()).toBe(false)
  })

  test('a clean log is not waited on', async () => {
    const order: string[] = []
    const waits: number[] = []
    const { engine, state } = fakeEngine({ log: order })
    state.isAlive = false
    const shutdown = createShutdown({
      engine,
      stores: [fakeStore({ log: order, name: 'state', isDirty: true }).store],
      writes: noWrites,
      log: cleanLog,
      warn: () => {},
      wait: (ms) => {
        waits.push(ms)
        return never()
      },
    })
    await shutdown.settle()
    expect(waits).toEqual([])
    expect(order).toEqual(['flush state'])
  })

  test('a flush that never settles is given LOG_FLUSH_MS, warned, and then gives up the quit', async () => {
    const order: string[] = []
    const warn = mock((_message: string) => {})
    const deadline = Promise.withResolvers<void>()
    const waits: number[] = []
    const { engine, state } = fakeEngine({ log: order })
    state.isAlive = false
    const hung = fakeLog({ log: order, isHeld: true })
    const shutdown = createShutdown({
      engine,
      stores: [fakeStore({ log: order, name: 'state', isDirty: true }).store],
      writes: noWrites,
      log: hung.log,
      warn,
      wait: (ms) => {
        waits.push(ms)
        return deadline.promise
      },
    })
    const settling = shutdown.settle()
    await settle()
    expect(order).toEqual(['flush state', 'flush log'])
    expect(waits).toEqual([LOG_FLUSH_MS])
    deadline.resolve()
    await settling
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0] ?? '').toContain('log')
    // Still dirty, but given up on: the quit gate quits rather than exiting hard.
    expect(hung.state.isDirty).toBe(true)
    expect(shutdown.isPending()).toBe(false)
    // The stores flush again; the log is neither flushed nor waited on again.
    await shutdown.settle()
    expect(waits).toEqual([LOG_FLUSH_MS])
    expect(order).toEqual(['flush state', 'flush log', 'flush state'])
  })

  test('fits in the quit gate after mpv has had its DESTROY_MS', () => {
    expect(DESTROY_MS + LOG_FLUSH_MS).toBeLessThan(QUIT_FLUSH_MS)
  })

  test('a quit gate over a hung log still quits within its bound', async () => {
    const order: string[] = []
    const { engine } = fakeEngine({ log: order })
    const deadline = Promise.withResolvers<void>()
    const shutdown = createShutdown({
      engine,
      stores: [fakeStore({ log: order, name: 'state', isDirty: true }).store],
      writes: noWrites,
      log: fakeLog({ log: order, isHeld: true }).log,
      warn: () => {},
      wait: () => deadline.promise,
    })
    const ended = Promise.withResolvers<string>()
    const gate = createQuitGate({
      isDirty: shutdown.isPending,
      flush: shutdown.settle,
      timeoutMs: QUIT_FLUSH_MS,
      quit: () => ended.resolve('quit'),
      exit: () => ended.resolve('exit'),
      wait: never,
    })
    gate({ preventDefault: () => {} })
    await settle()
    deadline.resolve()
    expect(await ended.promise).toBe('quit')
    expect(order).toEqual(['destroy', 'flush state', 'flush log'])
  })
})

describe('endAfterLog', () => {
  test('ends once the log has written, without waiting out the bound', async () => {
    const order: string[] = []
    await endAfterLog({
      log: {
        flush: async () => {
          order.push('flush')
        },
      },
      wait: never,
      end: () => order.push('end'),
    })
    expect(order).toEqual(['flush', 'end'])
  })

  test('does not end while the log writes within its bound', async () => {
    const order: string[] = []
    const written = Promise.withResolvers<void>()
    const ending = endAfterLog({
      log: { flush: () => written.promise },
      wait: never,
      end: () => order.push('end'),
    })
    await settle()
    expect(order).toEqual([])
    written.resolve()
    await ending
    expect(order).toEqual(['end'])
  })

  test('ends after LOG_FLUSH_MS when the log never writes', async () => {
    const order: string[] = []
    const waits: number[] = []
    await endAfterLog({
      log: { flush: never },
      wait: async (ms) => {
        waits.push(ms)
      },
      end: () => order.push('end'),
    })
    expect(waits).toEqual([LOG_FLUSH_MS])
    expect(order).toEqual(['end'])
  })

  test('ends when the flush rejects', async () => {
    const order: string[] = []
    await endAfterLog({
      log: {
        flush: async () => {
          throw new Error('disk gone')
        },
      },
      wait: never,
      end: () => order.push('end'),
    })
    expect(order).toEqual(['end'])
  })
})

describe('hardExitFor', () => {
  test('kills the process while mpv is alive, since teardown would wait on it forever', () => {
    expect(hardExitFor({ isEngineAlive: true })).toBe(HARD_EXITS.kill)
  })

  test('exits normally once mpv is gone', () => {
    expect(hardExitFor({ isEngineAlive: false })).toBe(HARD_EXITS.exit)
  })
})

describe('closeTimeoutFor', () => {
  test('a window close that timed out on a live mpv quits the app, so the stores flush', () => {
    expect(closeTimeoutFor({ isEngineAlive: true })).toBe(CLOSE_TIMEOUTS.quitApp)
  })

  test('a window close that timed out after mpv died destroys the window', () => {
    expect(closeTimeoutFor({ isEngineAlive: false })).toBe(CLOSE_TIMEOUTS.destroyWindow)
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

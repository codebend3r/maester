import { describe, expect, it } from 'bun:test'
import { createQuitGate } from '@/main/quitGate'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const deferred = () => {
  const handlers: { resolve: () => void; reject: (error: Error) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  }
  const promise = new Promise<void>((resolve, reject) => {
    handlers.resolve = resolve
    handlers.reject = reject
  })
  return { promise, ...handlers }
}

const setup = ({
  isDirty,
  flush,
  wait = () => new Promise<void>(() => undefined),
}: {
  isDirty: () => boolean
  flush: () => Promise<void>
  wait?: (ms: number) => Promise<void>
}) => {
  const calls = { prevented: 0, quit: 0, exit: 0, flush: 0, waits: [] as number[] }
  const gate = createQuitGate({
    isDirty,
    flush: () => {
      calls.flush += 1
      return flush()
    },
    timeoutMs: 1000,
    quit: () => {
      calls.quit += 1
    },
    exit: () => {
      calls.exit += 1
    },
    wait: (ms) => {
      calls.waits.push(ms)
      return wait(ms)
    },
  })
  const event = {
    preventDefault: () => {
      calls.prevented += 1
    },
  }
  return { gate, event, calls }
}

describe('createQuitGate', () => {
  it('lets the quit through when nothing is waiting to be saved', async () => {
    const { gate, event, calls } = setup({ isDirty: () => false, flush: async () => undefined })
    gate(event)
    await settle()
    expect(calls).toEqual({ prevented: 0, quit: 0, exit: 0, flush: 0, waits: [] })
  })

  it('holds the quit for a flush, then quits once it is saved', async () => {
    const state = { isDirty: true }
    const { gate, event, calls } = setup({
      isDirty: () => state.isDirty,
      flush: async () => {
        state.isDirty = false
      },
    })
    gate(event)
    await settle()
    expect(calls.prevented).toBe(1)
    expect(calls.flush).toBe(1)
    expect(calls.waits).toEqual([1000])
    expect(calls.quit).toBe(1)
    expect(calls.exit).toBe(0)
  })

  it('starts one flush however many quit events arrive while it runs', async () => {
    const state = { isDirty: true }
    const write = deferred()
    const { gate, event, calls } = setup({
      isDirty: () => state.isDirty,
      flush: () => write.promise,
    })
    gate(event)
    gate(event)
    expect(calls.prevented).toBe(2)
    expect(calls.flush).toBe(1)

    state.isDirty = false
    write.resolve()
    await settle()
    expect(calls.quit).toBe(1)
  })

  it('exits once the bound passes when the flush never settles', async () => {
    const timeout = deferred()
    const { gate, event, calls } = setup({
      isDirty: () => true,
      flush: () => new Promise<void>(() => undefined),
      wait: () => timeout.promise,
    })
    gate(event)
    await settle()
    expect(calls.exit).toBe(0)

    timeout.resolve()
    await settle()
    expect(calls.waits).toEqual([1000])
    expect(calls.exit).toBe(1)
    expect(calls.quit).toBe(0)
  })

  it('exits when the flush fails, since a failed write is not retried', async () => {
    const { gate, event, calls } = setup({
      isDirty: () => true,
      flush: async () => {
        throw new Error('disk full')
      },
    })
    gate(event)
    await settle()
    expect(calls.exit).toBe(1)
    expect(calls.quit).toBe(0)
  })

  it('lets the quit it started through once the flush has saved', async () => {
    const state = { isDirty: true }
    const { gate, event, calls } = setup({
      isDirty: () => state.isDirty,
      flush: async () => {
        state.isDirty = false
      },
    })
    gate(event)
    await settle()
    gate(event)
    expect(calls.prevented).toBe(1)
    expect(calls.flush).toBe(1)
  })
})

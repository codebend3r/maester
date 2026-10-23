import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'

import { clearOnServerSwitch } from '@/queries/serverCache'

const KEY = ['home']

describe('clearOnServerSwitch', () => {
  it("drops the cache when the active server changes, and keeps it when it doesn't", () => {
    const client = new QueryClient()
    const store = create<{ activeId: string | null; name: string }>()(() => ({
      activeId: 'a',
      name: 'nas',
    }))
    const stop = clearOnServerSwitch({ client, store })
    const cached = (): unknown => client.getQueryData(KEY)
    client.setQueryData(KEY, 'from a')

    store.setState({ name: 'renamed' })
    expect(cached()).toBe('from a')

    store.setState({ activeId: 'b' })
    expect(cached()).toBeUndefined()

    stop()
    client.setQueryData(KEY, 'from b')
    store.setState({ activeId: 'a' })
    expect(cached()).toBe('from b')
  })
})

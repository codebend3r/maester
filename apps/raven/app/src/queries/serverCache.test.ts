import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'

import { clearOnServerSwitch, clearOnSignOut } from '@/queries/serverCache'

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

describe('clearOnSignOut', () => {
  const ACTIVE = 'a'
  const OTHER = 'b'

  const setUp = () => {
    const client = new QueryClient()
    const accounts = create<{ signedIn: Readonly<Record<string, boolean>> }>()(() => ({
      signedIn: { [ACTIVE]: true, [OTHER]: true },
    }))
    const stop = clearOnSignOut({ client, accounts, activeId: () => ACTIVE })
    client.setQueryData(KEY, 'from a')
    return { client, accounts, stop, cached: (): unknown => client.getQueryData(KEY) }
  }

  it("drops the cache when the active server's account signs out", () => {
    const { accounts, cached } = setUp()
    accounts.setState({ signedIn: { [ACTIVE]: true, [OTHER]: true } })
    expect(cached()).toBe('from a')

    accounts.setState({ signedIn: { [ACTIVE]: false, [OTHER]: true } })
    expect(cached()).toBeUndefined()
  })

  it("keeps it when another server's account signs out, whose answers it never holds", () => {
    const { accounts, cached } = setUp()
    accounts.setState({ signedIn: { [ACTIVE]: true, [OTHER]: false } })
    expect(cached()).toBe('from a')
  })

  it('keeps it when an account that was not signed in is noted signed out again', () => {
    const { client, accounts, cached } = setUp()
    accounts.setState({ signedIn: { [ACTIVE]: false } })
    client.setQueryData(KEY, 'after')
    accounts.setState({ signedIn: { [ACTIVE]: false } })
    expect(cached()).toBe('after')
  })

  it('stops listening once stopped', () => {
    const { accounts, stop, cached } = setUp()
    stop()
    accounts.setState({ signedIn: { [ACTIVE]: false } })
    expect(cached()).toBe('from a')
  })
})

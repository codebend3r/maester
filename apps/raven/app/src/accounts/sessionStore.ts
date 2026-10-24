import { isRecord, isString } from '@raven/core'

import { type SecretStore, settle } from '@/servers/secretStore'
import { isServerId } from '@/servers/serverList'

/** The storage auth-js keeps one server's session in. */
export type SessionStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

/** Each server's account session, kept in the secure store and nowhere else. */
export type SessionStore = {
  storageFor: (serverId: string) => SessionStorage
  forget: (serverId: string) => Promise<void>
}

type Items = Readonly<Record<string, string>>

const EMPTY: Items = {}

const ACCOUNT_KEY_PREFIX = 'raven.account.'

export const accountKeyFor = (serverId: string): string => `${ACCOUNT_KEY_PREFIX}${serverId}`

const isItems = (value: unknown): value is Items =>
  isRecord(value) && Object.values(value).every(isString)

/** What the store held, read as untrusted: a map of auth-js's items, or null for anything else. */
const itemsOf = (stored: string): Items | null => {
  try {
    const parsed: unknown = JSON.parse(stored)
    return isItems(parsed) ? parsed : null
  } catch {
    return null
  }
}

// The id names the store's key, whose characters the secure store limits.
const checkId = (serverId: string): void => {
  if (!isServerId(serverId)) throw new Error('That is not a server id.')
}

/**
 * Each server's sign-in as one JSON value under `raven.account.<serverId>`, holding auth-js's
 * items. A server is read from the store once and held in memory after, so a store that throws
 * or holds something unreadable signs the viewer out for the run, as the cookie jar degrades,
 * and a value that cannot be read is removed. A write that fails keeps the sign-in for this run
 * alone. Writes to one server take turns, so two landing together never lose one another.
 */
export const createSessionStore = ({ store }: { store: SecretStore }): SessionStore => {
  let known: ReadonlyMap<string, Items> = new Map()
  let turns: ReadonlyMap<string, Promise<void>> = new Map()

  const hold = ({ serverId, items }: { serverId: string; items: Items }): void => {
    known = new Map([...known, [serverId, items]])
  }

  const load = async (serverId: string): Promise<Items> => {
    const key = accountKeyFor(serverId)
    const stored = await settle({ work: store.getItemAsync(key), fallback: null })
    if (stored === null) return EMPTY
    const items = itemsOf(stored)
    if (items !== null) return items
    await settle({ work: store.deleteItemAsync(key), fallback: undefined })
    return EMPTY
  }

  const read = async (serverId: string): Promise<Items> => {
    const held = known.get(serverId)
    if (held !== undefined) return held
    const items = await load(serverId)
    // A write that landed while the store was read has the newer word.
    const landed = known.get(serverId)
    if (landed !== undefined) return landed
    hold({ serverId, items })
    return items
  }

  const save = async ({ serverId, items }: { serverId: string; items: Items }): Promise<void> => {
    hold({ serverId, items })
    const key = accountKeyFor(serverId)
    const work =
      Object.keys(items).length === 0
        ? store.deleteItemAsync(key)
        : store.setItemAsync(key, JSON.stringify(items))
    await settle({ work, fallback: undefined })
  }

  const inTurn = ({ serverId, work }: { serverId: string; work: () => Promise<void> }) => {
    const turn = (turns.get(serverId) ?? Promise.resolve()).then(work)
    turns = new Map([...turns, [serverId, turn.catch(() => undefined)]])
    return turn
  }

  const change = ({ serverId, edit }: { serverId: string; edit: (items: Items) => Items }) =>
    inTurn({
      serverId,
      work: async () => save({ serverId, items: edit(await read(serverId)) }),
    })

  const storageFor = (serverId: string): SessionStorage => {
    checkId(serverId)
    return {
      getItem: async (key) => (await read(serverId))[key] ?? null,
      setItem: (key, value) => change({ serverId, edit: (items) => ({ ...items, [key]: value }) }),
      removeItem: (key) =>
        change({
          serverId,
          edit: (items) =>
            Object.fromEntries(Object.entries(items).filter(([name]) => name !== key)),
        }),
    }
  }

  const forget = (serverId: string): Promise<void> => {
    checkId(serverId)
    return inTurn({ serverId, work: () => save({ serverId, items: EMPTY }) })
  }

  return { storageFor, forget }
}

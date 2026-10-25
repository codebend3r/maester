const DATABASE = { name: 'raven-listings', store: 'records', version: 1 } as const

export type ListingStore = {
  read: (scope: string) => Promise<unknown>
  write: (options: { scope: string; record: unknown }) => Promise<void>
  clear: () => Promise<void>
}

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE.name, DATABASE.version)
    opening.addEventListener('upgradeneeded', () =>
      opening.result.createObjectStore(DATABASE.store),
    )
    opening.addEventListener('success', () => resolve(opening.result))
    opening.addEventListener('error', () =>
      reject(opening.error ?? new Error('IndexedDB would not open')),
    )
  })

const request = async <T>({
  mode,
  act,
}: {
  mode: IDBTransactionMode
  act: (store: IDBObjectStore) => IDBRequest<T>
}): Promise<T> => {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const pending = act(database.transaction(DATABASE.store, mode).objectStore(DATABASE.store))
      pending.addEventListener('success', () => resolve(pending.result))
      pending.addEventListener('error', () =>
        reject(pending.error ?? new Error('IndexedDB would not answer')),
      )
    })
  } finally {
    database.close()
  }
}

/**
 * Where the library listings are kept between visits: IndexedDB, as a big
 * library's cards outgrow the few megabytes localStorage allows. A browser
 * that refuses it (a private window, a full disk) just has nothing saved, so
 * every call settles without throwing.
 */
export const listingStore: ListingStore = {
  read: (scope) =>
    request({ mode: 'readonly', act: (store) => store.get(scope) }).catch(() => undefined),
  write: ({ scope, record }) =>
    request({ mode: 'readwrite', act: (store) => store.put(record, scope) }).then(
      () => undefined,
      () => undefined,
    ),
  clear: () =>
    request({ mode: 'readwrite', act: (store) => store.clear() }).then(
      () => undefined,
      () => undefined,
    ),
}

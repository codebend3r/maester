import { type PersistOptions, type StateStorage, createJSONStorage } from 'zustand/middleware'

/** The slice of a persisted zustand store loading it reads. */
type PersistedStore<S, U> = {
  persist: {
    setOptions: (options: Partial<PersistOptions<S, U>>) => void
    rehydrate: () => Promise<void> | void
  }
}

type LoadPersistedProps<S, U> = { store: PersistedStore<S, U>; storage: StateStorage }

/** Gives a store its storage, AsyncStorage on the device, and reads it back from it. */
export const loadPersisted = async <S, U>({
  store,
  storage,
}: LoadPersistedProps<S, U>): Promise<void> => {
  store.persist.setOptions({ storage: createJSONStorage<U>(() => storage) })
  await store.persist.rehydrate()
}

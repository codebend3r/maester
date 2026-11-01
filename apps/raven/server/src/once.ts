type OnceRunProps<T> = { key: string; make: () => Promise<T> }

type Once<T> = {
  /** Runs `make` once per key at a time; later callers wait on the same promise. */
  run: (props: OnceRunProps<T>) => Promise<T>
  /** Settles once every run started so far has, for a shutdown to wait on. */
  settled: () => Promise<unknown>
}

/** Work shared by key while it runs: the key frees itself once its promise settles. */
export const createOnce = <T>(): Once<T> => {
  const working = new Map<string, Promise<T>>()
  return {
    run: ({ key, make }) => {
      const running = working.get(key)
      if (running) return running
      const started = make().finally(() => working.delete(key))
      working.set(key, started)
      return started
    },
    settled: () => Promise.allSettled(working.values()),
  }
}

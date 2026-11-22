type RememberedEntry<V> = { expiresAt: number; value: V }

type RememberedSetProps<K, V> = { key: K; value: V }

/** Values kept by key for `ttlMs` after each is set, then forgotten. */
export class Remembered<K, V> {
  private readonly entries = new Map<K, RememberedEntry<V>>()

  constructor(private readonly ttlMs: number) {}

  /** The value kept for `key`; null once it has expired, or when none was kept. */
  get(key: K): V | null {
    const entry = this.entries.get(key)
    if (entry === undefined) return null
    if (entry.expiresAt > Date.now()) return entry.value
    this.entries.delete(key)
    return null
  }

  set({ key, value }: RememberedSetProps<K, V>): void {
    this.entries.set(key, { expiresAt: Date.now() + this.ttlMs, value })
  }
}

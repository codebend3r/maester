import type { Clock } from '@/clock'

/** How long one of Coming soon's reads of TMDB is served before TMDB is asked again. */
export const UPCOMING_FRESH_MS = 6 * 60 * 60 * 1000

/** The day `at` falls on, as TMDB's `YYYY-MM-DD`. */
export const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10)

type FreshReadsProps = {
  clock: Clock
  /** How many reads are kept before the oldest go. */
  most: number
}

type FreshReadProps<T> = { key: string; read: () => Promise<T> }

/**
 * Reads kept by key for `UPCOMING_FRESH_MS`, so everyone asking within it
 * shares one, the one in flight included. A read that fails is not kept, so
 * the next ask tries again.
 */
export class FreshReads<T> {
  private readonly held = new Map<string, { at: number; value: Promise<T> }>()

  constructor(private readonly props: FreshReadsProps) {}

  read({ key, read }: FreshReadProps<T>): Promise<T> {
    const now = this.props.clock.now()
    const held = this.held.get(key)
    if (held && now - held.at < UPCOMING_FRESH_MS) return held.value
    const value = read()
    // Set anew so the Map's order stays oldest first.
    this.held.delete(key)
    this.held.set(key, { at: now, value })
    value.catch(() => {
      if (this.held.get(key)?.value === value) this.held.delete(key)
    })
    const overflow = [...this.held.keys()].slice(0, Math.max(0, this.held.size - this.props.most))
    overflow.forEach((old) => this.held.delete(old))
    return value
  }
}

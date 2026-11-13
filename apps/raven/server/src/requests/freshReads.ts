import type { Clock } from '@/clock'

/** A read under way (`settledAt` null) or one that landed, and its answer. */
type FreshRead<T> = { settledAt: number | null; answer: Promise<T> }

type FreshReadsProps = { clock: Clock; freshMs: number }

type ReadProps<T> = { key: string; read: () => Promise<T> }

type EntryProps<T> = { key: string; entry: FreshRead<T> }

type MarkProps<T> = { key: string; answer: T }

/**
 * One read of an arr per key at a time, its answer kept `freshMs` after it
 * lands. A read that fails is forgotten, so the next ask reads again.
 */
export class FreshReads<T> {
  private readonly reads = new Map<string, FreshRead<T>>()
  private readonly clock: Clock
  private readonly freshMs: number

  constructor({ clock, freshMs }: FreshReadsProps) {
    this.clock = clock
    this.freshMs = freshMs
  }

  /** The answer under way or still fresh for `key`, or `read`'s. */
  read({ key, read }: ReadProps<T>): Promise<T> {
    const kept = this.reads.get(key)
    const isFresh =
      kept !== undefined &&
      (kept.settledAt === null || this.clock.now() - kept.settledAt < this.freshMs)
    if (isFresh) return kept.answer
    const answer = read()
    const entry = { settledAt: null, answer } as const satisfies FreshRead<T>
    this.reads.set(key, entry)
    answer.then(
      () => this.settle({ key, entry }),
      () => this.forget({ key, entry }),
    )
    return answer
  }

  /** Marks the read landed, unless a newer one took its key meanwhile. */
  private settle({ key, entry }: EntryProps<T>): boolean {
    if (this.reads.get(key) !== entry) return false
    this.reads.set(key, { settledAt: this.clock.now(), answer: entry.answer })
    return true
  }

  private forget({ key, entry }: EntryProps<T>): boolean {
    return this.reads.get(key) === entry && this.reads.delete(key)
  }

  /** Keeps `answer` for `key` as if a read had just landed it. */
  mark({ key, answer }: MarkProps<T>): void {
    this.reads.set(key, { settledAt: this.clock.now(), answer: Promise.resolve(answer) })
  }
}

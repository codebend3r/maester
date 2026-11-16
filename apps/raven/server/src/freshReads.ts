import type { Clock } from '@/clock'

/** A read under way (`settledAt` null) or one that landed, and its answer. */
type FreshRead<T> = { settledAt: number | null; answer: Promise<T> }

type FreshReadsProps = {
  clock: Clock
  /** How long an answer is served after it lands. */
  freshMs: number
  /** How many reads are kept before the oldest go. */
  most: number
}

type ReadProps<T> = { key: string; read: () => Promise<T> }

type EntryProps<T> = { key: string; entry: FreshRead<T> }

type AnswerProps<T> = { key: string; answer: Promise<T> }

type MarkProps<T> = { key: string; answer: T }

/**
 * Reads kept by key, so everyone asking while one is under way, or within
 * `freshMs` of it landing, shares it. A read that fails is forgotten, so the
 * next ask reads again. Past `most` keys, the oldest read goes.
 */
export class FreshReads<T> {
  private readonly reads = new Map<string, FreshRead<T>>()

  constructor(private readonly props: FreshReadsProps) {}

  /** The answer under way or still fresh for `key`, or `read`'s. */
  read({ key, read }: ReadProps<T>): Promise<T> {
    const kept = this.reads.get(key)
    const isFresh =
      kept !== undefined &&
      (kept.settledAt === null || this.props.clock.now() - kept.settledAt < this.props.freshMs)
    if (isFresh) return kept.answer
    const answer = read()
    this.keep({ key, entry: { settledAt: null, answer } })
    answer.then(
      () => this.settle({ key, answer }),
      () => this.forget({ key, answer }),
    )
    return answer
  }

  /** Keeps `answer` for `key` as if a read had just landed it. */
  mark({ key, answer }: MarkProps<T>): void {
    this.keep({
      key,
      entry: { settledAt: this.props.clock.now(), answer: Promise.resolve(answer) },
    })
  }

  /** Set anew so the Map's order stays oldest first, then the oldest past `most` go. */
  private keep({ key, entry }: EntryProps<T>): void {
    this.reads.delete(key)
    this.reads.set(key, entry)
    const overflow = [...this.reads.keys()].slice(0, Math.max(0, this.reads.size - this.props.most))
    overflow.forEach((old) => this.reads.delete(old))
  }

  /** Whether `answer` is still the one kept for `key`, no newer read having taken it. */
  private isKept({ key, answer }: AnswerProps<T>): boolean {
    const kept = this.reads.get(key)
    return kept !== undefined && kept.answer === answer
  }

  /** Marks the read landed, where it keeps its place among the oldest. */
  private settle({ key, answer }: AnswerProps<T>): void {
    if (this.isKept({ key, answer }))
      this.reads.set(key, { settledAt: this.props.clock.now(), answer })
  }

  private forget({ key, answer }: AnswerProps<T>): void {
    if (this.isKept({ key, answer })) this.reads.delete(key)
  }
}

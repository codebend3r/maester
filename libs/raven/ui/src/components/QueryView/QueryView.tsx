import type { ReactNode } from 'react'

/**
 * Where a read stands: failed, on its way, or answered. A TanStack
 * `UseQueryResult` is one, and so is anything that folds several into one.
 */
export type QueryRead<T> =
  | { isError: true; error: Error }
  | { isError: false; isPending: true }
  | { isError: false; isPending: false; data: T }

type ReadSoFar<T> = { data: T | undefined; error: Error | null }

/**
 * A read that keeps what it last answered, so a later read that fails
 * leaves it in view: what it holds, else why it failed, else on its way.
 */
export const keptRead = <T,>({ data, error }: ReadSoFar<T>): QueryRead<T> => {
  if (data !== undefined) return { isError: false, isPending: false, data }
  if (error !== null) return { isError: true, error }
  return { isError: false, isPending: true }
}

/** What an answer that holds nothing to show shows instead, and how to tell one. */
export type QueryEmpty<T> = {
  isEmpty: (data: T) => boolean
  shown: ReactNode
}

type QueryViewProps<T> = {
  query: QueryRead<T>
  /** What stands in while the read is on its way. */
  pending: ReactNode
  /** Why the read failed. */
  renderFailed: (error: Error) => ReactNode
  /** What an empty answer shows; an answer is never empty when left out. */
  empty?: QueryEmpty<T>
  /** What an answer worth showing shows. */
  children: (data: T) => ReactNode
}

/** Whether a list holds nothing: the `isEmpty` of a read that answers a list. */
export const isNone = (list: readonly unknown[]): boolean => list.length === 0

/** The four places a read can stand, each with a view of its own. */
const QUERY_STATES = {
  failed: 'failed',
  pending: 'pending',
  empty: 'empty',
  answered: 'answered',
} as const

type FailedProps = { error: Error; renderFailed: (error: Error) => ReactNode }

type StandInProps = { shown: ReactNode }

type AnsweredProps = { render: () => ReactNode }

type QueryViewsProps = {
  [QUERY_STATES.failed]: FailedProps
  [QUERY_STATES.pending]: StandInProps
  [QUERY_STATES.empty]: StandInProps
  [QUERY_STATES.answered]: AnsweredProps
}

/** What each place a read stands renders, called in place so moving between them keeps the tree. */
type QueryRenders = {
  readonly [Key in keyof QueryViewsProps]: (props: QueryViewsProps[Key]) => ReactNode
}

const QUERY_RENDERS: QueryRenders = {
  [QUERY_STATES.failed]: ({ error, renderFailed }) => renderFailed(error),
  [QUERY_STATES.pending]: ({ shown }) => shown,
  [QUERY_STATES.empty]: ({ shown }) => shown,
  [QUERY_STATES.answered]: ({ render }) => render(),
} as const

type QueryShown<Key extends keyof QueryViewsProps> = { key: Key; props: QueryViewsProps[Key] }

type RenderShownProps<Key extends keyof QueryViewsProps> = { shown: QueryShown<Key> }

const renderShown = <Key extends keyof QueryViewsProps>({ shown }: RenderShownProps<Key>) => {
  const render: QueryRenders[Key] = QUERY_RENDERS[shown.key]
  return render(shown.props)
}

type QueryShownOf = { [Key in keyof QueryViewsProps]: QueryShown<Key> }[keyof QueryViewsProps]

/** Where a read stands, checked in order: failed, on its way, empty, answered. */
const viewOf = <T,>({
  query,
  pending,
  renderFailed,
  empty,
  children,
}: QueryViewProps<T>): QueryShownOf => {
  if (query.isError) {
    return { key: QUERY_STATES.failed, props: { error: query.error, renderFailed } }
  }
  if (query.isPending) return { key: QUERY_STATES.pending, props: { shown: pending } }
  const { data } = query
  if (empty !== undefined && empty.isEmpty(data)) {
    return { key: QUERY_STATES.empty, props: { shown: empty.shown } }
  }
  return { key: QUERY_STATES.answered, props: { render: () => children(data) } }
}

/**
 * A read in whichever state it stands: why it failed, its stand-in while
 * it is on its way, what it says when the answer holds nothing, or the
 * answer itself. Every screen that shows one read, or several taken as
 * one, goes through it rather than its own failed and empty views.
 */
export const QueryView = <T,>(props: QueryViewProps<T>) => renderShown({ shown: viewOf(props) })

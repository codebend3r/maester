import type { ComponentType, ReactNode } from 'react'
import styles from '@/components/ListState/ListState.module.scss'

/** Where a list stands: failed, on its way, read and empty, or read with entries. */
const LIST_STATES = {
  failed: 'failed',
  loading: 'loading',
  empty: 'empty',
  listed: 'listed',
} as const

type ListStateKey = (typeof LIST_STATES)[keyof typeof LIST_STATES]

type ListViewProps = {
  error: Error | null
  empty: string
  loading: ReactNode
  listed: () => ReactNode
}

type FailedProps = ListViewProps

const Failed = ({ error }: FailedProps) => (
  <p className={styles.message} role="alert">
    {error?.message ?? ''}
  </p>
)

type LoadingProps = ListViewProps

const Loading = ({ loading }: LoadingProps) => loading

type EmptyProps = ListViewProps

const Empty = ({ empty }: EmptyProps) => <p className={styles.message}>{empty}</p>

type ListedProps = ListViewProps

const Listed = ({ listed }: ListedProps) => listed()

const LIST_VIEWS = {
  [LIST_STATES.failed]: Failed,
  [LIST_STATES.loading]: Loading,
  [LIST_STATES.empty]: Empty,
  [LIST_STATES.listed]: Listed,
} as const satisfies Record<ListStateKey, ComponentType<ListViewProps>>

type ListStateOfProps = { count: number | null; error: Error | null }

const listStateOf = ({ count, error }: ListStateOfProps): ListStateKey => {
  if (error !== null) return LIST_STATES.failed
  if (count === null) return LIST_STATES.loading
  return count === 0 ? LIST_STATES.empty : LIST_STATES.listed
}

type ListStateProps<T> = {
  /** The entries once read; undefined while they are on their way. */
  entries: readonly T[] | undefined
  error: Error | null
  /** What the list says when it holds nothing. */
  empty: string
  /** What stands in while it is read; nothing when left out. */
  loading?: ReactNode
  children: (entries: readonly T[]) => ReactNode
}

/** A list in whichever state it stands: why it failed, its stand-in, its empty line, or its entries. */
export const ListState = <T,>({
  entries,
  error,
  empty,
  loading = null,
  children,
}: ListStateProps<T>) => {
  const View = LIST_VIEWS[listStateOf({ count: entries?.length ?? null, error })]
  return (
    <View error={error} empty={empty} loading={loading} listed={() => children(entries ?? [])} />
  )
}
